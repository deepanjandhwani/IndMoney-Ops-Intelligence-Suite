# FastMCP Google sidecar (Phase 4)

This process exposes **Google Calendar**, **Google Sheets**, and **Gmail draft creation** over the Model Context Protocol. There is **no** tool to send email (drafts only), matching ADR-005.

Canonical architecture notes: [docs/architecture/mcpIntegration.md](../docs/architecture/mcpIntegration.md) (including **`update_calendar_event`** and optional **`end_timezone`**).

## Prerequisites

- Python 3.11+ recommended
- Google Cloud project with **Calendar API**, **Sheets API**, and **Gmail API** enabled
- OAuth client of type **Desktop app** (recommended for local dev) saved as `credentials.json`
- Consent flow completed so `token.json` exists — run **`npm run phase4:oauth-login`** once (see **First-time Google sign-in** below)

## Install

From the repository root:

```bash
python3 -m pip install -r mcp/requirements-fastmcp.txt
```

## First-time Google sign-in (`token.json`)

**Starting `npm run phase4:mcp` only starts the HTTP server.** OAuth runs when Calendar/Sheets/Gmail APIs are used for the **first time**, so the browser often **does not open** just from starting the server.

Run this **once** from the repo root (loads `.env` then `.env.local`):

```bash
npm run phase4:oauth-login
```

A browser tab opens for Google consent; afterward **`GOOGLE_TOKEN_PATH`** (usually `credentials/token.json`) is created or updated.

- **Replace an old token:** `npm run phase4:oauth-login-force`
- **`token.json` is empty:** treated as missing; `--oauth-login` runs the browser flow.

Then start the sidecar: `npm run phase4:mcp`.

### Error `400: redirect_uri_mismatch`

Google only accepts redirect URLs that match your **OAuth client type** in [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services** → **Credentials** → your OAuth 2.0 Client ID.

**Fix A (simplest):** Create an OAuth client with application type **Desktop app**, download the new JSON, replace `credentials.json`, then run `npm run phase4:oauth-login` again. Desktop clients use the local loopback flow without you adding redirect URIs in the console.

**Fix B (if you must use “Web application”):** This project uses a **fixed local port** (default **8765**) for the consent redirect so you can whitelist it.

1. In the same Credentials screen, open your **Web client** → **Authorized redirect URIs** → **Add URI** and add **both** (trailing slash often required):
   - `http://localhost:8765/`
   - `http://127.0.0.1:8765/`
2. Save. Run `npm run phase4:oauth-login` again.

If port 8765 is busy, set `GOOGLE_OAUTH_LOCAL_PORT` in `.env` to another free port (e.g. `8766`) and add matching URIs for that port in the console.

### Error `403: access_denied` (“app has not completed the Google verification process”)

The **OAuth consent screen** is in **Testing** mode. Only accounts listed under **Test users** can sign in until you publish (and often complete Google’s app verification for sensitive scopes).

1. [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services** → **OAuth consent screen**.
2. Under **Test users**, click **Add users** and add **every** Google account you use to sign in (e.g. personal `@gmail.com` and work Gmail/Workspace if applicable).
3. Save, then run `npm run phase4:oauth-login-force` again and choose that same account in the Google account picker.

For a capstone/demo, **stay in Testing** with an explicit test-user list; moving to **Production** can require verification when Calendar/Gmail scopes are used.

---

## Step-by-step: what to put in `.env` / `.env.local` and where values come from

Copy [`.env.example`](../.env.example) to `.env` and/or `.env.local` for Next.js. **`npm run phase4:mcp`** (or `python3 mcp/groww_ops_mcp_server.py`) run **from the repo root** automatically load **`.env`** then **`.env.local`** via `python-dotenv`, so you usually do **not** need to `export` Google paths manually.

Below: what each value is and how to obtain it.

### 1. `MCP_SERVER_URL` (Next.js only)

- **What:** URL of the MCP **SSE** endpoint the TypeScript app connects to.
- **Default in repo:** `http://localhost:8000/sse`
- **Where to get it:** If you change `FASTMCP_PORT` or run the sidecar on another host, set this to `http://<host>:<port>/sse` (path is `/sse` for FastMCP’s default SSE transport).

### 2. `GOOGLE_CREDENTIALS_PATH`

- **What:** Filesystem path to the **OAuth client secret** JSON from Google Cloud (often named `credentials.json`).
- **Where to get it:**
  1. Open [Google Cloud Console](https://console.cloud.google.com/) → select or create a project.
  2. **APIs & Services** → **Library** → enable **Google Calendar API**, **Google Sheets API**, **Gmail API**.
  3. **APIs & Services** → **OAuth consent screen** → configure (External or Internal per your org), add scopes for Calendar, Sheets, and Gmail compose as needed; add your Google account as a **test user** while in Testing mode.
  4. **APIs & Services** → **Credentials** → **Create credentials** → **OAuth client ID** → Application type **Desktop app** → Create → **Download JSON**.
  5. Save the file as e.g. `./credentials/credentials.json` (folder is gitignored) and set `GOOGLE_CREDENTIALS_PATH=./credentials/credentials.json`.

### 3. `GOOGLE_TOKEN_PATH`

- **What:** Where the **user refresh token** is stored after you complete the browser consent flow once.
- **Where to get it:** Not downloaded from a console. It is **created automatically** the first time you run the FastMCP server (or any flow using `InstalledAppFlow`): after you sign in and approve scopes, the app writes this file. Point it to e.g. `./credentials/token.json` and keep it private (gitignored).

### 4. `GOOGLE_ADVISOR_CALENDAR_ID`

- **What:** Calendar id used for advisor holds (FreeBusy, create, update, cancel, add attendee when not overridden per call).
- **Where to get it:**
  - Often `primary` for “the signed-in user’s main calendar”.
  - Or the calendar’s id from [Google Calendar](https://calendar.google.com/) → **Settings** for the specific calendar → **Integrate calendar** section may show the id (email-like for user calendars).
- **Example:** `primary` or `you@yourdomain.com`.

### 5. `GOOGLE_SHEET_ID`

- **What:** The spreadsheet id in the Google Sheets URL: `https://docs.google.com/spreadsheets/d/<THIS_PART>/edit`.
- **Where to get it:** Create or open a sheet in [Google Sheets](https://sheets.google.com/), copy the id segment from the URL. The OAuth account must have edit access to this file.

### 6. `GOOGLE_SHEET_TAB`

- **What:** The **name of the tab** (worksheet) where booking rows are appended (`A:J`).
- **Default:** `Bookings` (must match a tab that exists in the spreadsheet, or create one with that name).

### 7. `GOOGLE_ADVISOR_EMAIL`

- **What:** Gmail address for the **same Google account** that completed OAuth. Used as default **From** / **To** for advisor drafts in the TypeScript adapter when you don’t pass overrides.
- **Where to get it:** The email you used when authorizing the app (e.g. `advisor@company.com`).

### 8. `FASTMCP_HOST` / `FASTMCP_PORT` (optional, Python only)

- **What:** Bind address and port for the FastMCP SSE server.
- **Defaults:** `127.0.0.1` and `8000`.
- **Where to get it:** Only change if port 8000 conflicts (e.g. with another service). If you change the port, update `MCP_SERVER_URL` in `.env.local` to match.

### Minimal checklist before `npm run phase4:mcp`

1. `credentials/credentials.json` exists (from Cloud Console).
2. APIs enabled and test user added on consent screen.
3. `.env.local` (and/or exported env) includes the variables above paths and ids.
4. First run opens a browser → you approve → `token.json` appears at `GOOGLE_TOKEN_PATH`.

**Scopes requested by the server** (free tier OAuth):

- `https://www.googleapis.com/auth/calendar`
- `https://www.googleapis.com/auth/spreadsheets`
- `https://www.googleapis.com/auth/gmail.compose`

---

## Quick reference — env table

| Variable | Used by | Purpose |
|----------|---------|---------|
| `MCP_SERVER_URL` | Next.js (TS MCP client) | SSE URL of the FastMCP process |
| `GOOGLE_CREDENTIALS_PATH` | Python sidecar | Path to OAuth **client** JSON |
| `GOOGLE_TOKEN_PATH` | Python sidecar | Path to **user** token JSON (generated after consent) |
| `GOOGLE_ADVISOR_CALENDAR_ID` | Both (defaults in TS adapters) | Default calendar id |
| `GOOGLE_SHEET_ID` | TS adapters / services | Spreadsheet id |
| `GOOGLE_SHEET_TAB` | TS adapters | Worksheet tab name |
| `GOOGLE_ADVISOR_EMAIL` | TS adapters | Advisor mailbox for drafts |
| `FASTMCP_HOST` / `FASTMCP_PORT` | Python only | SSE server bind |

## Run the server

Default SSE URL matches Next.js `.env.example`:

```bash
export GOOGLE_CREDENTIALS_PATH=./credentials/credentials.json
export GOOGLE_TOKEN_PATH=./credentials/token.json
export GOOGLE_ADVISOR_CALENDAR_ID=primary
# …spreadsheet id, advisor email…
PYTHONPATH=mcp python3 mcp/groww_ops_mcp_server.py
```

Or: `npm run phase4:mcp` from repo root (same env must be exported or loaded).

The MCP SSE endpoint defaults to `http://127.0.0.1:8000/sse` (set `MCP_SERVER_URL` in the Node app accordingly).

## Verify tool surface

```bash
PYTHONPATH=mcp python3 mcp/verify_tool_surface.py
```

## Deployment note

For the capstone free tier, this server is intended to run as a **local or sidecar** process next to the Next.js app (`ADR-006`, `ADR-008`). Hosted deployment needs an approved free always-on target and should be documented in a new ADR before production use.
