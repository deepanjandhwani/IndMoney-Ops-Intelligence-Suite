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
Decision: Gemini text-embedding-004 (resolved in docs/architecture/ragA.md)
768 dimensions, MTEB Retrieval NDCG@10 ~66.0, free tier (1,500 RPM, 10M TPM),
no GPU required, multilingual (Hindi-mixed queries supported),
TypeScript native via @google/generative-ai.
Alternative considered: Cohere embed-v3.0 (1,000 calls/month cap too tight),
Voyage AI voyage-3-lite (deprecated), all-MiniLM-L6-v2 (14-point quality gap,
Python dependency in TypeScript project), bge-small-en-v1.5 (same issues)
Cost: Free
Date: 2026-04-28

## ADR-003: Theme clustering approach
Decision: BERTopic (UMAP + HDBSCAN + c-TF-IDF) with pre-computed
Gemini text-embedding-004 embeddings (resolved in docs/architecture/themeClassification.md)
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
Decision: Two-model split on Gemini free tier.
- Generation tasks (RAG answers, pulse summary, label refinement, action ideas,
  preparation guidance): Gemini 2.5 Flash (10 RPM, 500 RPD).
- Classification and safety tasks (intent classification, safety checks,
  query classification): Gemini 2.5 Flash-Lite (15 RPM, 1,000 RPD).
- Advisor email drafts are template-based and read cached Review Pulse context
  from the database; they do not make a separate LLM call.
Alternative considered:
- Groq Llama 3 (free: 30 RPM) — viable fallback for classification and safety
  if Gemini rate limit is hit.
- Cohere Command R+ (free: 1,000 calls/month) — rejected; monthly cap too tight
  for development iteration.
Note: Gemini 2.0 Flash was deprecated Feb 2026 and retired March 3, 2026.
All references in this project use 2.5-series models.
Strategy: Flash-Lite for high-volume cheap tasks (classification, safety).
Flash for quality-sensitive generation. Groq Llama 3 as fallback for classification/safety only.
Cost: Free
Date: 2026-04-30

## ADR-010: LLM call caching
Decision: Cache weekly outputs in database.
- Review Pulse: regenerated weekly, served from DB between runs
- Top themes: stored in DB, read by Scheduler at greeting time
- Review Trends: computed weekly, served from DB
Reason: Avoid redundant LLM calls. Stay within free tier limits.
Cost: Free
Date: 2026-04-28

## ADR-011: Application Database
Decision: Supabase free tier (Postgres, 500MB, cloud hosted, built-in dashboard)
Alternative considered: SQLite (fully local, no signup — good for local-only dev but incompatible
with Vercel serverless), Railway Postgres (free tier, 1GB — less ecosystem integration)
Reason: Vercel serverless functions have no persistent filesystem, ruling out SQLite.
Supabase provides hosted Postgres with a web dashboard for data inspection, generous free tier
(500MB, 50K MAU), JavaScript client (@supabase/supabase-js) for Next.js API routes,
and Python client (supabase-py) for the clustering pipeline.
Cost: Free
Date: 2026-04-30

## ADR-012: ChromaDB collection structure
Decision: Single collection smart_sync_kb with metadata filters
Alternative considered: Two separate collections faq_chunks
and fee_chunks
Reason: Multi-hop retrieval requires querying both chunk types
in a single pass. Single collection with metadata filters
is cleaner and avoids cross-collection merge logic.
Affects: src/rag/retrieve.ts, src/rag/agenticRAG.ts
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