# Architecture Decision Records

## ADR-001: Vector Database
Decision: ChromaDB (fully local, free)
Alternative considered: Pinecone free tier (cloud, 2GB free), 
pgvector in Supabase (shares DB space with app data)
Reason: Fully free, no cloud dependency, runs locally, 
Has both Python and TypeScript clients — used from TypeScript (RAG retrieval via chromadb npm)
and Python (clustering pipeline). No cloud dependency, no signup needed.
If remote deployment needed later, can migrate to Pinecone free tier.
Cost: Free
Date: 2026-04-28

## ADR-002: Embedding model
Decision: Gemini gemini-embedding-001 (resolved in docs/architecture/ragA.md)
768 output dimensions, free tier via Gemini API / AI Studio,
no GPU required, multilingual (Hindi-mixed queries supported),
TypeScript native via @google/generative-ai.
Alternative considered: Cohere embed-v3.0 (1,000 calls/month cap too tight),
Voyage AI voyage-3-lite, all-MiniLM-L6-v2 (quality gap,
Python dependency in TypeScript project), bge-small-en-v1.5 (same issues)
Cost: Free
Date: 2026-04-28

## ADR-003: Theme clustering approach
Decision: BERTopic (UMAP + HDBSCAN + c-TF-IDF) with pre-computed
Gemini gemini-embedding-001 embeddings (resolved in docs/architecture/themeClassification.md)
Auto k (no elbow/silhouette needed), noise handling (generic reviews excluded),
c-TF-IDF keyword labels without LLM. 3 Gemini 2.5 Flash calls/week
(label refinement, action ideas, pulse summary) — all within free tier.
Python batch script (scripts/cluster_reviews.py) runs in GitHub Actions,
isolated from TypeScript app runtime. No GPU, no PyTorch.
Alternative considered: K-Means (requires k upfront, no noise handling,
no readable labels), HDBSCAN alone (no c-TF-IDF labels)
Cost: Free
Date: 2026-04-28

## ADR-004: Voice provider
Decision: Deepgram (free tier: $200 signup credits)
Fallback: Web Speech API (fully free, browser-only, less reliable)
Reason: Server-side STT, consistent across browsers.
Free credits sufficient for capstone development and demo.
Cost: Free for capstone/demo while credits remain; credit-limited and must fall back to Web Speech API or chat if exhausted.
Date: 2026-04-28

## ADR-005: Email handling
Decision: Draft only via Gmail (FastMCP). Never auto-send.
Reason: Spec requires Admin approval before customer-facing action.
Date: 2026-04-28

## ADR-006: Hosting
Decision: Vercel free tier (frontend + API routes) + Supabase free tier (Postgres DB, cloud hosted). For the free-tier capstone demo, ChromaDB and the FastMCP server run as local/sidecar services; production deployment requires an explicitly approved free long-running host.
Alternative considered: Railway free, Render free, local only
Reason: Vercel pairs naturally with Next.js 14 App Router. Supabase provides hosted Postgres
with a dashboard for data inspection. Both have generous free tiers. The clustering pipeline runs in GitHub Actions; the FastMCP server is a sidecar for local/demo use unless a free host is configured.
Note: GitHub Actions provides 2,000 free minutes/month for private repos (unlimited for public).
The weekly ingestion + clustering workflow uses ~5 minutes per run.
Constraint: No GPU. Free tier only.
Cost: Free
Date: 2026-04-30

## ADR-007: RAG vector index type
Decision: Cosine similarity + hybrid retrieval with BM25 rerank
(resolved in docs/architecture/ragA.md)
Distance metric: cosine similarity in ChromaDB.
Retrieval: hybrid — metadata-filtered vector search (top-10),
then BM25 keyword rerank with 70% cosine / 30% BM25 weighting
to final top-5. BM25 enforces term precision for semantically
close financial terms (exit load vs expense ratio vs lock-in).
Cost: Free (ChromaDB local, BM25 local algorithm)
Date: 2026-04-28

## ADR-008: MCP implementation
Decision: FastMCP
Reason: Previously used, simpler than raw MCP protocol.
Used for: Google Calendar, Google Sheets, Gmail integrations.
Cost: Free
Date: 2026-04-28

## ADR-009: LLM provider and model selection
Decision: Two-model split on Gemini free tier with Groq fallback.
- Generation tasks (RAG answers, pulse summary, label refinement, action ideas,
  preparation guidance): Gemini 2.5 Flash (10 RPM, 500 RPD).
- Classification and safety tasks (intent classification, safety checks,
  query classification, query rewriting): Gemini 2.5 Flash-Lite (15 RPM, 1,000 RPD).
- Advisor email drafts are template-based and read cached Review Pulse context
  from the database; they do not make a separate LLM call.
Groq fallback:
- Classification/safety primary: Groq llama-3.1-8b-instant (sub-second inference).
  Fallback model: llama3-8b-8192.
- Generation last-resort: Groq llama-3.3-70b-versatile — used when Gemini is
  overloaded (503/429). This extends ADR-009 beyond classification-only Groq use.
Alternative considered:
- Cohere Command R+ (free: 1,000 calls/month) — rejected; monthly cap too tight
  for development iteration.
Note: Gemini 2.0 Flash was deprecated Feb 2026 and retired March 3, 2026.
All references in this project use 2.5-series models.
Strategy: Flash-Lite for high-volume cheap tasks (classification, safety).
Flash for quality-sensitive generation. Groq as fallback — llama-3.1-8b-instant
for classification/safety, llama-3.3-70b-versatile for generation if Gemini rate-limited.
Cost: Free
Date: 2026-04-30 (updated 2026-05-07)

## ADR-010: LLM call caching
Decision: Cache weekly outputs in database.
- Review Pulse: regenerated weekly, served from DB between runs
- Top themes: stored in DB, read by Scheduler at greeting time
- Review Trends: computed weekly, served from DB
Reason: Avoid redundant LLM calls. Stay within free tier limits.
Cost: Free
Date: 2026-04-28

## ADR-011: Application Database
Decision: Supabase free tier (Postgres, 500MB, cloud hosted, built-in dashboard) for core application data (reviews, bookings, HITL). Chat history uses SQLite as a zero-cost fallback when Supabase is unavailable (See ADR-019).
Alternative considered: SQLite (fully local, no signup — good for local-only dev but incompatible
with Vercel serverless), Railway Postgres (free tier, 1GB — less ecosystem integration)
Reason: Vercel serverless functions have no persistent filesystem, ruling out SQLite for core data.
Supabase provides hosted Postgres with a web dashboard for data inspection, generous free tier
(500MB, 50K MAU), JavaScript client (@supabase/supabase-js) for Next.js API routes,
and Python client (supabase-py) for the clustering pipeline. For chat history specifically,
SQLite provides a free local fallback that works without Supabase credentials.
Cost: Free
Date: 2026-04-30 (updated 2026-05-04)

## ADR-012: ChromaDB collection structure
Decision: Single collection `smart-sync-kb` with metadata filters
Alternative considered: Two separate collections faq_chunks
and fee_chunks
Reason: Multi-hop retrieval requires querying both chunk types
in a single pass. Single collection with metadata filters
is cleaner and avoids cross-collection merge logic.
Note: Originally named `smart_sync_kb`; renamed to `smart-sync-kb` for ChromaDB v2 API compatibility.
Affects: src/rag/retrieve.ts, src/rag/classify.ts, src/rag/faq.ts
Cost: Free
Date: 2026-04-28

## ADR-013: TypeScript ↔ Python communication
Decision: MCP SSE transport for FastMCP server communication.
The Python FastMCP server runs as a standalone process exposing an SSE endpoint.
Next.js API routes call it via @modelcontextprotocol/sdk TypeScript client.
Alternative considered: HTTP REST (defeats MCP purpose), subprocess/stdio (fragile in production)
Cost: Free
Date: 2026-04-30

## ADR-014: Language boundary
Decision: TypeScript for business logic (Next.js API routes, state machine, adapters, UI).
Python for MCP server (FastMCP) and clustering pipeline (BERTopic).
Both connect to Supabase — TypeScript via @supabase/supabase-js, Python via supabase-py.
ChromaDB accessed from TypeScript (RAG retrieval via chromadb npm) and Python (embedding storage).
Date: 2026-04-30

## ADR-015: Secure details storage
Decision: Store only secure-details token hashes in bookings and store submitted secure details as encrypted ciphertext in `secure_details_submissions`.
Reason: Raw secure-link tokens and customer details should not be stored in AI chat/voice transcripts or plain booking rows. Token hashes support lookup/expiry without exposing bearer tokens.
Alternative considered: Store opaque token and details directly on `bookings`.
Cost: Free
Date: 2026-04-30

## ADR-016: Review clustering implementation
Decision: Implement the BERTopic-style review clustering pipeline directly with UMAP, HDBSCAN, and c-TF-IDF components instead of importing the `bertopic` package.
Reason: The selected algorithm remains the same, but direct component usage avoids sentence-transformers/PyTorch dependency risk and keeps the weekly GitHub Actions job lighter.
Alternative considered: Install `bertopic>=0.16` and pass precomputed Gemini embeddings.
Cost: Free
Date: 2026-04-30

## ADR-017: Review Pulse export and Supabase retention
Decision: Keep Supabase (`review_pulse`, `theme_snapshots`, `reviews`) as the authoritative store.
Write a derived JSON export to `artifacts/review-pulse-latest.json` after each successful clustering run for demos and offline review.
Apply lightweight retention after clustering: retain the newest 26 `review_pulse` rows (snapshots cascade-delete), delete `ingestion_runs` older than 90 days, and leave reviews/embeddings untouched unless storage becomes constrained.
Alternative considered: Treat JSON as primary storage or delete historical reviews automatically — rejected because DB-backed lineage and embeddings remain valuable on the free tier until size forces a change.
Cost: Free
Date: 2026-05-01

## ADR-018: Selected fintech product
Decision: Retarget the capstone application from the previous product context to Groww.
Reason: The project decision is now to use Groww as the selected fintech product context across Review Pulse, Smart-Sync FAQ, advisor scheduling, and documentation.
Alternative considered: Continue with the previous product context.
Cost: Free
Date: 2026-05-01

## ADR-019: Chat history storage — SQLite fallback
Decision: Use local SQLite (better-sqlite3) as the default chat history store, with Supabase as a preferred backend when credentials are present.
Reason: Supabase free tier expires after one month, creating a hard dependency on a paid service for chat history. SQLite provides zero-cost, always-available local persistence that runs in-process with Next.js. The SQLite repository implements the same interface as the Supabase repository, so the fallback is transparent — API routes no longer return 503 when Supabase is unconfigured.
Alternative considered: Turso/PlanetScale (external services with eventual cost), localStorage-only (client-side only, no server persistence), JSON files (no concurrency safety).
Storage location: `.data/chat-history.sqlite` (gitignored).
Cost: Free
Date: 2026-05-04

## ADR-020: LLM-powered query rewriting for pronoun resolution
Decision: Before query classification and embedding, detect pronouns ("this", "that", "its", "the fund", etc.) in the user query and rewrite it into a self-contained question using conversation history via a lightweight Gemini call.
Reason: The existing `FaqSessionContext` (active_fund, last_topic) only influenced metadata filters in ChromaDB — it did not rewrite the query text sent to the embedder. This meant "What is the AUM of this fund?" produced a vague embedding that matched poorly, even when the correct fund was tracked in context. The rewrite step produces a fully explicit query (e.g., "What is the AUM of HDFC Transportation and Logistics Fund Direct Growth?"), dramatically improving both embedding quality and answer relevance.
Fallback: If rewrite fails, returns garbage (<5 chars), lacks word overlap with the original query, is >2x the original length, or does not end with "?", the original query is used unchanged.
Cost: Free (reuses the existing classification model, adds ~1 Gemini call per pronoun-bearing query)
Date: 2026-05-04

## ADR-021: Fund filter bar with metadata from scraper
Decision: Replace the conditional fund-chip onboarding section with an always-visible 3-dimension filter bar (Fund Type, Risk Profile, Fund Name) above the chat. Fund type is set statically in source_urls.json. Risk category is extracted from the Groww page riskometer section during scraping and written back to source_urls.json as structured metadata. A `/api/smart-sync-faq/funds` GET endpoint serves the catalog. Selected funds are sent as `selected_funds` in the FAQ POST body to scope ChromaDB retrieval.
Reason: Cross-fund comparative questions overwhelmed retrieval with too many chunks or triggered unnecessary "which fund?" clarifications. Structured filters let users proactively scope their queries by type, risk, or individual fund names.
Alternative considered: Keep the old FUND_GROUPS chips (conditional, only visible when no active fund, no risk dimension).
Cost: Free
Date: 2026-05-04

## ADR-022: Smart category fallback in normalizeCategory
Decision: When the LLM returns an unknown category string, apply heuristic mapping instead of blindly defaulting to `scheme_fact`. If the string contains "help"/"process"/"how_to", map to `process_help`; if it contains "fee"/"charge"/"cost", map to `fee_explanation`; otherwise default to `scheme_fact`. Log a warning in all cases.
Reason: Blind `scheme_fact` default applied a `content_type: "scheme_fact"` filter to Chroma, which excluded `help_page` and `fee_explanation` chunks. This caused legitimate process_help and fee queries to return `no_results` when the LLM produced typos or novel category names.
Alternative considered: Reject unknown categories and return `no_results` (too aggressive), or remove all metadata filters on unknown (too broad).
Cost: Free
Date: 2026-05-05

## ADR-023: Module-level singleton clients for FAQ API route
Decision: Move `createChromaVectorStore()` and `createGeminiRagClient()` to lazy-initialized module-level singletons in the FAQ API route. Next.js serverless functions reuse the module scope across warm invocations, so clients persist across requests within the same instance.
Reason: Per-request client creation caused connection storms to ChromaDB and repeated Gemini SDK initialization under load. 50 concurrent requests each created a fresh Chroma HTTP client, overflowing ChromaDB's connection pool.
Alternative considered: Connection pooling middleware (adds complexity), external connection manager.
Cost: Free
Date: 2026-05-05

## ADR-004a: TTS provider amendment — Deepgram Aura TTS
Decision: Switch TTS from Browser SpeechSynthesis to Deepgram Aura TTS (server-side, consumes from $200 signup credits). Browser SpeechSynthesis becomes the fallback when Deepgram credits are exhausted or the API is unreachable.
Supersedes: ADR-004 TTS portion only. ADR-004 STT portion (Deepgram STT primary, Web Speech API fallback) remains unchanged.
Reason: Browser SpeechSynthesis produces robotic, inconsistent output across OS/browser combinations. It reads booking codes as single words ("NL-A742" → "nla seven forty-two"), reads IST times incorrectly ("16:00" → "sixteen hundred"), and cannot be controlled for pacing or pronunciation. For a capstone demo where voice quality is evaluated, this undermines the user experience. Deepgram Aura TTS provides consistent natural-sounding voice across all clients, configurable pronunciation for booking codes and times, and ~150-300ms latency acceptable for turn-based conversation.
Cost impact: At ~$0.0043/1K characters, a typical booking conversation (~500 chars TTS output) costs ~$0.002. The $200 credit pool supports ~100,000 TTS responses combined with STT usage (~45 hrs audio) — far beyond capstone needs.
Fallback: If Deepgram credits are exhausted, fall back to Browser SpeechSynthesis ($0). The voice-format pipeline (formatForVoice, buildTtsText) still improves Browser SpeechSynthesis output compared to raw text.
Cost: $0 while credits remain (credit-limited). Fallback: $0.
Date: 2026-05-06

## ADR-024: Voice transport — HTTP batch instead of WebSocket streaming
Decision: Use HTTP batch POST (`/api/scheduler/voice-turn`) for the voice pipeline instead of WebSocket streaming (`/api/voice/stream`).
Supersedes: voiceAgent.md Section 1.4 (Audio Streaming Design) which specified WebSocket transport with 250ms PCM chunks.
Reason: Vercel serverless functions do not support persistent WebSocket connections. A WebSocket voice endpoint would require a separate always-on server (Railway, Fly.io, self-hosted), contradicting ADR-006 (Vercel free tier hosting). HTTP batch fits within Vercel's function timeout (maxDuration: 30s), matches the reference implementation's proven architecture, and simplifies client code (MediaRecorder vs AudioWorklet).
Trade-off: No interim transcripts — the user sees nothing until mic is released. This requires a hold-to-talk UX (press and hold mic, release to send). Latency is ~1-2s per turn vs ~0.3s for streaming first words. Acceptable for turn-based scheduling conversations with short phrases.
Alternative considered: WebSocket streaming via separate server (adds infrastructure cost and deployment complexity), Vercel Edge Runtime with WebSocket (experimental, not production-ready on free tier).
Cost: Free (same Deepgram API, different transport)
Date: 2026-05-06

## ADR-025: LLM fallback for scheduler — deterministic-first with Gemini structured output
Decision: Add Gemini 2.5 Flash-Lite as a structured-output fallback behind the existing deterministic regex parsers in the scheduler state machine. The fallback fires only when regex returns null/unclear. Feature-flagged via `SCHEDULER_LLM_FALLBACK=true` env var (default: off).
Supersedes: voiceAgent.md Section 9 budget tables (previously guaranteed exactly 1 LLM call per booking for intent classification). The current code makes 0 LLM calls (fully deterministic regex). This ADR adds 0-2 fallback calls per conversation for edge cases only.
Reason: Regex-only parsing fails on natural/ambiguous inputs common in voice ("my nominee situation needs sorting out", "the day after the long weekend"). The reference implementation uses this pattern successfully. Deterministic-first preserves speed and cost for common inputs; LLM handles the long tail.
Fallback points: (1) Intent classification — when classifySchedulerIntent returns "unclear". (2) Day resolution — when resolveDayPreference returns null.
Budget impact: Typical case remains 0 LLM calls. Worst case: 2 calls × ~80 tokens = ~160 tokens using Flash-Lite (15 RPM, 1,000 RPD). Well within free tier.
Timeout: 5-second timeout per LLM call. On timeout or error, return null (ask user to clarify, same as regex miss).
Cost: Free (Gemini free tier)
Date: 2026-05-06

## ADR-026: Slot selection — regex hardening, state alignment, and always-on LLM fallback
Decision: Three changes to improve natural-language slot selection in the scheduler:
(1) Rewrite `matchSlotBySpokenTime` to use a priority cascade: explicit H:MM am/pm → H:MM bare → digit+am/pm → word-hour with spoken minutes (e.g. "eleven thirty") → word-hour alone. Bare digits without colon or am/pm no longer match as hours, preventing "31" in "eleven 31" from being parsed as hour 31.
(2) Change `check_availability` path to transition to `slot_selection` instead of `closing` when slots are offered, so the next turn gets the same slot-parsing + LLM recovery as a direct booking flow.
(3) Remove `isSchedulerLlmEnabled()` gate from `selectSlotLlm` only. Slot LLM fallback now fires whenever regex fails and GEMINI_API_KEY is set. Other LLM fallbacks (intent, topic, confirmation, booking code) remain behind `SCHEDULER_LLM_FALLBACK=true`.
Reason: User reported "Can you go with the eleven 31?" failing to select slot 2 (11:30 am). Root cause: bare `\d{1,2}` regex matched "31" as hour before word "eleven" was considered. The `closing` state had weaker slot recovery than `slot_selection`. Slot selection is the highest-impact LLM fallback since it directly blocks booking completion.
Alternative considered: Run Gemini on every scheduler turn (nextleap-voice-agent style) — rejected due to latency on voice and cost concerns. Conditional invocation keeps the happy path at 0 LLM calls.
Cost: Free (same Gemini free tier; adds at most 1 LLM call when regex misses a slot choice)
Date: 2026-05-07
