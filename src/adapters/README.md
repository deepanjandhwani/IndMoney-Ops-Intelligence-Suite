# Adapters

External system clients live here:

- **`google-mcp/`** — TypeScript MCP client (SSE to the Python FastMCP sidecar) plus Calendar / Sheets / Gmail draft wrappers. Server runbook: `mcp/README.md`.
- Playwright scraper(s), google-play-scraper, ChromaDB, LLM adapters, Supabase repos.

UI code must not call these adapters directly. Route handlers and services own adapter orchestration.
