"""
Groww Ops FastMCP server: Google Calendar, Sheets, Gmail drafts (create/get/send).
Run from repo root: PYTHONPATH=mcp python3 mcp/groww_ops_mcp_server.py
"""

from __future__ import annotations

import base64
import os
from datetime import datetime, timedelta, timezone
from email.mime.text import MIMEText
from pathlib import Path
from typing import Any

from fastmcp import FastMCP
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

SCOPES = [
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/gmail.modify",
]

mcp = FastMCP(
    name="groww-ops-google-mcp",
    instructions="Google Calendar holds, Sheets booking rows, Gmail drafts (create/get/send). "
    "Emails are sent only via the send_email_draft tool after HITL admin review.",
)


def _env_path(key: str) -> Path:
    raw = os.environ.get(key)
    if not raw:
        raise RuntimeError(f"Missing required environment variable: {key}")
    return Path(raw).expanduser().resolve()


def _oauth_loopback_port() -> int:
    """Fixed port helps avoid redirect_uri_mismatch for 'Web application' OAuth clients."""
    raw = (os.environ.get("GOOGLE_OAUTH_LOCAL_PORT") or "8765").strip()
    return int(raw) if raw else 8765


def _is_headless() -> bool:
    return bool(os.environ.get("RAILWAY_ENVIRONMENT") or os.environ.get("HEADLESS"))


def _run_oauth_installed_flow(flow: Any) -> Credentials:
    """
    Use a fixed localhost port by default so authorize redirect URIs match Google Cloud.
    In headless environments (Railway), raise instead of trying to open a browser.
    """
    if _is_headless():
        raise RuntimeError(
            "Interactive OAuth flow is unavailable in headless mode. "
            "Pre-provision token.json via GOOGLE_TOKEN_JSON_B64 env var."
        )
    port = _oauth_loopback_port()
    try:
        return flow.run_local_server(port=port, open_browser=True)
    except OSError as e:
        errno = getattr(e, "errno", None)
        addr_in_use = errno == 48 or "Address already in use" in str(e) or "already in use" in str(e).lower()
        if not addr_in_use:
            raise
        return flow.run_local_server(port=0, open_browser=True)


def _token_missing_or_empty(tok_path: Path) -> bool:
    if not tok_path.exists():
        return True
    try:
        return tok_path.stat().st_size == 0
    except OSError:
        return True


def _load_credentials() -> Credentials:
    cred_path = _env_path("GOOGLE_CREDENTIALS_PATH")
    tok_path = _env_path("GOOGLE_TOKEN_PATH")

    if _token_missing_or_empty(tok_path):
        from google_auth_oauthlib.flow import InstalledAppFlow

        flow = InstalledAppFlow.from_client_secrets_file(str(cred_path), SCOPES)
        creds = _run_oauth_installed_flow(flow)
        tok_path.parent.mkdir(parents=True, exist_ok=True)
        with open(tok_path, "w", encoding="utf-8") as fh:
            fh.write(creds.to_json())
        return creds

    try:
        creds = Credentials.from_authorized_user_file(str(tok_path), SCOPES)
    except Exception:
        # Corrupt or wrong format — redo consent
        tok_path.unlink(missing_ok=True)
        from google_auth_oauthlib.flow import InstalledAppFlow

        flow = InstalledAppFlow.from_client_secrets_file(str(cred_path), SCOPES)
        creds = _run_oauth_installed_flow(flow)
        tok_path.parent.mkdir(parents=True, exist_ok=True)
        with open(tok_path, "w", encoding="utf-8") as fh:
            fh.write(creds.to_json())
        return creds

    if creds.expired:
        if creds.refresh_token:
            try:
                creds.refresh(Request())
                with open(tok_path, "w", encoding="utf-8") as fh:
                    fh.write(creds.to_json())
            except Exception:
                creds = None
        if creds is None or not creds.valid:
            from google_auth_oauthlib.flow import InstalledAppFlow

            flow = InstalledAppFlow.from_client_secrets_file(str(cred_path), SCOPES)
            creds = _run_oauth_installed_flow(flow)
            with open(tok_path, "w", encoding="utf-8") as fh:
                fh.write(creds.to_json())
    if not creds.valid:
        from google_auth_oauthlib.flow import InstalledAppFlow

        flow = InstalledAppFlow.from_client_secrets_file(str(cred_path), SCOPES)
        creds = _run_oauth_installed_flow(flow)
        with open(tok_path, "w", encoding="utf-8") as fh:
            fh.write(creds.to_json())

    return creds


_cal_svc: Any | None = None
_sheets_svc: Any | None = None
_gmail_svc: Any | None = None


def _calendar_service():
    global _cal_svc
    if _cal_svc is None:
        _cal_svc = build("calendar", "v3", credentials=_load_credentials(), cache_discovery=False)
    return _cal_svc


def _sheets_service():
    global _sheets_svc
    if _sheets_svc is None:
        _sheets_svc = build("sheets", "v4", credentials=_load_credentials(), cache_discovery=False)
    return _sheets_svc


def _gmail_service():
    global _gmail_svc
    if _gmail_svc is None:
        _gmail_svc = build("gmail", "v1", credentials=_load_credentials(), cache_discovery=False)
    return _gmail_svc


def _resolve_calendar_id(explicit: str | None) -> str:
    cal = (explicit or os.environ.get("GOOGLE_ADVISOR_CALENDAR_ID") or "").strip()
    if not cal:
        raise RuntimeError(
            "advisor_calendar is empty and GOOGLE_ADVISOR_CALENDAR_ID is not set."
        )
    return cal


def _parse_iso(dt: str) -> datetime:
    s = dt.strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    parsed = datetime.fromisoformat(s)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _merge_busy(cal_busy: list[dict[str, str]]) -> list[tuple[datetime, datetime]]:
    spans: list[tuple[datetime, datetime]] = []
    for b in cal_busy:
        spans.append((_parse_iso(b["start"]), _parse_iso(b["end"])))
    spans.sort(key=lambda x: x[0])
    merged: list[tuple[datetime, datetime]] = []
    for start, end in spans:
        if not merged:
            merged.append((start, end))
            continue
        ps, pe = merged[-1]
        if start <= pe:
            merged[-1] = (ps, max(pe, end))
        else:
            merged.append((start, end))
    return merged


def _overlaps(a0: datetime, a1: datetime, b0: datetime, b1: datetime) -> bool:
    return a0 < b1 and b0 < a1


@mcp.tool()
def read_calendar_availability(
    advisor_calendar: str,
    window_start: str,
    window_end: str,
    timezone: str,
    slot_duration_minutes: int = 30,
) -> dict[str, Any]:
    """Return FreeBusy calendar data plus contiguous free slot suggestions."""
    svc = _calendar_service()
    body = {
        "timeMin": window_start,
        "timeMax": window_end,
        "timeZone": timezone,
        "items": [{"id": advisor_calendar}],
    }
    fb = svc.freebusy().query(body=body).execute()
    cal_entry = fb.get("calendars", {}).get(advisor_calendar, {})
    busy_raw = cal_entry.get("busy", [])
    merged = _merge_busy(busy_raw)

    w0 = _parse_iso(window_start)
    w1 = _parse_iso(window_end)
    step = timedelta(minutes=max(5, int(slot_duration_minutes)))
    suggested: list[dict[str, str]] = []
    cursor = w0
    while cursor + step <= w1:
        slot_end = cursor + step
        clash = any(_overlaps(cursor, slot_end, b0, b1) for b0, b1 in merged)
        if not clash:
            suggested.append(
                {"start_time": cursor.isoformat(), "end_time": slot_end.isoformat()}
            )
        cursor += step

    return {
        "advisor_calendar": advisor_calendar,
        "timezone": timezone,
        "window_start": window_start,
        "window_end": window_end,
        "slot_duration_minutes": int(slot_duration_minutes),
        "busy_periods": busy_raw,
        "suggested_available_slots": suggested,
    }


@mcp.tool()
def create_calendar_hold(
    title: str,
    start_time: str,
    end_time: str,
    timezone: str,
    booking_code: str,
    advisor_calendar: str,
    description: str = "",
) -> dict[str, Any]:
    """Create an advisor calendar hold. Does not add the customer as an attendee."""
    cal_id = _resolve_calendar_id(advisor_calendar)
    svc = _calendar_service()
    event_body = {
        "summary": title,
        "start": {"dateTime": start_time, "timeZone": timezone},
        "end": {"dateTime": end_time, "timeZone": timezone},
        "description": f"Booking Code: {booking_code}\n{description}".strip(),
    }
    ev = svc.events().insert(calendarId=cal_id, body=event_body).execute()
    return {
        "event_id": ev["id"],
        "status": "created",
        "html_link": ev.get("htmlLink"),
        "booking_code": booking_code,
        "customer_attendee_added": False,
    }


@mcp.tool()
def update_calendar_event(
    event_id: str,
    advisor_calendar: str | None = None,
    title: str | None = None,
    start_time: str | None = None,
    end_time: str | None = None,
    end_timezone: str | None = None,
    description: str | None = None,
) -> dict[str, Any]:
    """Patch an existing event (reschedule or add details)."""
    cal_id = _resolve_calendar_id(advisor_calendar)
    svc = _calendar_service()
    ev = svc.events().get(calendarId=cal_id, eventId=event_id).execute()
    if title is not None:
        ev["summary"] = title
    if description is not None:
        ev["description"] = description
    tz = end_timezone or (ev.get("end") or {}).get("timeZone") or "Asia/Kolkata"
    if start_time is not None:
        ev.setdefault("start", {})
        ev["start"]["dateTime"] = start_time
        ev["start"]["timeZone"] = tz
    if end_time is not None:
        ev.setdefault("end", {})
        ev["end"]["dateTime"] = end_time
        ev["end"]["timeZone"] = tz
    updated = svc.events().update(calendarId=cal_id, eventId=event_id, body=ev).execute()
    return {"event_id": updated["id"], "status": "updated", "html_link": updated.get("htmlLink")}


@mcp.tool()
def add_customer_attendee(
    event_id: str,
    customer_email: str,
    customer_name: str | None = None,
    advisor_calendar: str | None = None,
) -> dict[str, Any]:
    """Add attendee after secure-details + Admin approval (per product rules)."""
    cal_id = _resolve_calendar_id(advisor_calendar)
    svc = _calendar_service()
    ev = svc.events().get(calendarId=cal_id, eventId=event_id).execute()
    attendees = list(ev.get("attendees") or [])
    attendees.append({"email": customer_email, "displayName": customer_name or ""})
    ev["attendees"] = attendees
    updated = (
        svc.events()
        .update(calendarId=cal_id, eventId=event_id, body=ev, sendUpdates="all")
        .execute()
    )
    return {
        "event_id": updated["id"],
        "status": "attendee_added",
        "customer_attendee_added": True,
    }


@mcp.tool()
def cancel_calendar_event(
    event_id: str,
    advisor_calendar: str | None = None,
) -> dict[str, Any]:
    """Cancel (delete) a calendar event."""
    cal_id = _resolve_calendar_id(advisor_calendar)
    svc = _calendar_service()
    svc.events().delete(calendarId=cal_id, eventId=event_id).execute()
    return {"event_id": event_id, "status": "cancelled"}


def _pulse_themes_cell(row_data: dict[str, Any]) -> str:
    themes = row_data.get("weekly_pulse_themes") or []
    if isinstance(themes, str):
        return themes
    if isinstance(themes, list):
        return ", ".join(str(t) for t in themes)
    return ""


@mcp.tool()
def append_sheet_row(
    spreadsheet_id: str,
    sheet_name: str,
    row_data: dict[str, Any],
) -> dict[str, Any]:
    """Append a booking tracking row (fixed A–J column order per architecture spec)."""
    svc = _sheets_service()
    values_row = [
        row_data.get("date", ""),
        row_data.get("product", "Groww"),
        row_data.get("topic", ""),
        row_data.get("slot", ""),
        row_data.get("booking_code", ""),
        _pulse_themes_cell(row_data),
        row_data.get("source", "Advisor Scheduler"),
        row_data.get("approval_status", "pending_admin_confirmation"),
        row_data.get("advisor_calendar_status", ""),
        row_data.get("advisor_email_draft_status", ""),
    ]
    rng = f"{sheet_name}!A:J"
    result = (
        svc.spreadsheets()
        .values()
        .append(
            spreadsheetId=spreadsheet_id,
            range=rng,
            valueInputOption="USER_ENTERED",
            insertDataOption="INSERT_ROWS",
            body={"values": [values_row]},
        )
        .execute()
    )
    return {
        "updated_range": (result.get("updates") or {}).get("updatedRange"),
        "spreadsheet_url": f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}",
    }


@mcp.tool()
def update_sheet_row(
    spreadsheet_id: str,
    sheet_name: str,
    row_identifier: str,
    updates: dict[str, Any],
) -> dict[str, Any]:
    """Locate the row via booking_code in column E and patch selective columns."""
    svc = _sheets_service()
    data = (
        svc.spreadsheets()
        .values()
        .get(spreadsheetId=spreadsheet_id, range=f"{sheet_name}!A:J")
        .execute()
        .get("values", [])
    )
    row_idx: int | None = None
    for i, row in enumerate(data):
        code = row[4] if len(row) > 4 else ""
        if code == row_identifier:
            row_idx = i + 1  # 1-based sheet row index
            break
    if row_idx is None:
        return {"status": "not_found", "booking_code": row_identifier}

    col_map = {
        "approval_status": 7,
        "advisor_calendar_status": 8,
        "advisor_email_draft_status": 9,
        "slot": 3,
        "topic": 2,
        "booking_code": 4,
        "weekly_pulse_themes": 5,
        "date": 0,
        "product": 1,
        "source": 6,
    }

    for field, idx in col_map.items():
        if field not in updates:
            continue
        col_letter = chr(ord("A") + idx)
        cell_range = f"{sheet_name}!{col_letter}{row_idx}"
        val = updates[field]
        if field == "weekly_pulse_themes" and isinstance(val, list):
            val = ", ".join(str(x) for x in val)
        (
            svc.spreadsheets()
            .values()
            .update(
                spreadsheetId=spreadsheet_id,
                range=cell_range,
                valueInputOption="USER_ENTERED",
                body={"values": [[val]]},
            )
            .execute()
        )

    return {"status": "updated", "row": row_idx, "booking_code": row_identifier}


@mcp.tool()
def create_email_draft(
    to: str,
    subject: str,
    body: str,
    sender: str,
) -> dict[str, Any]:
    """Create Gmail draft. Admin must review and send via send_email_draft."""
    svc = _gmail_service()
    message = MIMEText(body, "plain", "utf-8")
    message["To"] = to
    message["From"] = sender
    message["Subject"] = subject
    raw = base64.urlsafe_b64encode(message.as_bytes()).decode()
    draft = svc.users().drafts().create(userId="me", body={"message": {"raw": raw}}).execute()
    return {
        "draft_id": draft["id"],
        "message_id": draft["message"]["id"],
        "status": "draft_created",
    }


@mcp.tool()
def get_email_draft(draft_id: str) -> dict[str, Any]:
    """Retrieve a Gmail draft for preview. Returns subject, to, body text."""
    svc = _gmail_service()
    draft = svc.users().drafts().get(userId="me", id=draft_id, format="full").execute()
    msg = draft.get("message", {})
    headers = {h["name"].lower(): h["value"] for h in msg.get("payload", {}).get("headers", [])}

    body_text = ""
    payload = msg.get("payload", {})
    if payload.get("body", {}).get("data"):
        body_text = base64.urlsafe_b64decode(payload["body"]["data"]).decode("utf-8", errors="replace")
    elif payload.get("parts"):
        for part in payload["parts"]:
            if part.get("mimeType") == "text/plain" and part.get("body", {}).get("data"):
                body_text = base64.urlsafe_b64decode(part["body"]["data"]).decode("utf-8", errors="replace")
                break

    return {
        "draft_id": draft["id"],
        "subject": headers.get("subject", ""),
        "to": headers.get("to", ""),
        "from": headers.get("from", ""),
        "body": body_text,
        "status": "retrieved",
    }


@mcp.tool()
def send_email_draft(draft_id: str) -> dict[str, Any]:
    """Send a previously created Gmail draft. Only callable after HITL admin review."""
    svc = _gmail_service()
    result = svc.users().drafts().send(userId="me", body={"id": draft_id}).execute()
    return {
        "message_id": result.get("id", ""),
        "thread_id": result.get("threadId", ""),
        "status": "sent",
    }


def _load_repo_dotenv() -> None:
    """Load `.env` then `.env.local` from repo root (Next.js convention)."""
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    root = Path(__file__).resolve().parent.parent
    load_dotenv(root / ".env")
    load_dotenv(root / ".env.local", override=True)


def main() -> None:
    _load_repo_dotenv()
    host = os.environ.get("FASTMCP_HOST", "127.0.0.1")
    port = int(os.environ.get("FASTMCP_PORT", "8000"))
    mcp.run(
        transport="sse",
        host=host,
        port=port,
    )


if __name__ == "__main__":
    import sys

    _load_repo_dotenv()

    if "--oauth-login" in sys.argv:
        if "--force" in sys.argv:
            _env_path("GOOGLE_TOKEN_PATH").unlink(missing_ok=True)
        _ = _load_credentials()
        tp = os.environ.get("GOOGLE_TOKEN_PATH", "")
        print(f"Google OAuth OK. Refresh token saved to {tp!r}")
        sys.exit(0)

    main()
