# Adapters

External system clients live here: Google services through FastMCP, Playwright, google-play-scraper, ChromaDB, and LLM providers.

UI code must not call these adapters directly. Route handlers and services own adapter orchestration.
