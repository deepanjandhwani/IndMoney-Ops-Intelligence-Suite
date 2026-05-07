#!/usr/bin/env python3
"""Assert exposed FastMCP tool names; fail if a send primitive appears."""

from __future__ import annotations

import asyncio

EXPECTED = {
    "read_calendar_availability",
    "create_calendar_hold",
    "update_calendar_event",
    "add_customer_attendee",
    "cancel_calendar_event",
    "append_sheet_row",
    "update_sheet_row",
    "create_email_draft",
    "get_email_draft",
    "send_email_draft",
}
FORBIDDEN_SUBSTRINGS = ("messages.send", "gmail_send")


def main() -> None:
    import groww_ops_mcp_server as srv  # noqa: PLC0415 — requires PYTHONPATH=mcp

    async def _run() -> None:
        tools_meta = await srv.mcp.list_tools(run_middleware=False)
        tools = {t.name for t in tools_meta}
        missing = EXPECTED - tools
        if missing:
            raise AssertionError(f"missing tools: {sorted(missing)}")
        for name in tools:
            lowered = name.lower()
            for ban in FORBIDDEN_SUBSTRINGS:
                if ban in lowered:
                    raise AssertionError(
                        f"forbidden tool name pattern {ban!r} matched {name!r}"
                    )

    asyncio.run(_run())


if __name__ == "__main__":
    try:
        main()
    except AssertionError as exc:
        raise SystemExit(str(exc)) from exc
