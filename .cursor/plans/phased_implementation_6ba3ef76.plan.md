---
name: Phased Implementation
overview: Implement the Groww Ops Intelligence Suite in spec-driven phases, resolving blocking documentation mismatches at the phase where they affect code and verifying each phase before moving on.
todos:
  - id: phase-0-doc-scaffold
    content: Resolve blocking docs, env inventory, and scaffold project shell before feature code
    status: completed
  - id: phase-1-data-safety
    content: Implement schema, PII masking, booking-code generation, and centralized model config
    status: completed
  - id: phase-2-review-pulse
    content: Build Google Play ingestion, BERTopic clustering, and Review Pulse storage
    status: completed
  - id: phase-3-rag-faq
    content: Build approved-source ingestion, ChromaDB retrieval, cited FAQ answering, and safety checks
    status: completed
  - id: phase-4-fastmcp
    content: Build real FastMCP Google Calendar, Sheets, and Gmail draft integrations
    status: completed
  - id: phase-5-chat-hitl
    content: Build chat scheduler, secure-details flow, and HITL approval lifecycle
    status: completed
  - id: phase-6-voice
    content: Add Deepgram/Web Speech voice mode over the shared scheduler state machine
    status: completed
  - id: phase-7-admin-ui
    content: Build dashboards, role-aware navigation, trends, and integration retry UI
    status: completed
  - id: phase-8-evals
    content: Implement full evaluation suite and hardening checks
    status: completed
isProject: false
---

# Phase-Wise Implementation Plan

## Guiding Approach

Implement one phase at a time. Before starting each phase, reconcile only the documentation needed for that phase, then code the smallest vertical slice, then verify with focused checks.

Canonical constraints to keep open while implementing:
- [docs/rules.md](docs/rules.md): cost, PII, advice, citation, booking, sync rules.
- [docs/decisions.md](docs/decisions.md): ADR choices and free-tier commitments.
- [docs/edgeCase.md](docs/edgeCase.md): failure modes to implement and test.
- [docs/architecture.md](docs/architecture.md): module map, schema, and phase order.

## Phase 0: Spec Alignment and Project Scaffold

Goal: make implementation safe to start without drifting from docs.

Work:
- Reconcile blocking doc conflicts found in the audit: deployment model, Phase 4 FastMCP dependency, secure-details data path, canonical greeting, LLM safety for preparation guidance, status enums, and `.env.example` completeness.
- Scaffold Next.js 14 App Router project if not already present.
- Add project folders that match repo rules: UI, services, adapters, data models, scripts, evals.
- Add env var inventory for Supabase, Gemini, Deepgram, ChromaDB, FastMCP, Google OAuth, and GitHub workflow secrets.

Acceptance:
- No unresolved implementation-blocking contradictions in phase-relevant docs.
- `.env.example` lists all required non-secret variable names.
- App starts locally with empty pages and role-aware shell.

## Phase 1: Data Layer and Core Safety Utilities

Goal: establish database schema and shared invariants before feature work.

Work:
- Create Supabase schema for `reviews`, `ingestion_runs`, `review_pulse`, `theme_snapshots`, `review_embeddings`, `bookings`, `hitl_actions`, and secure-details storage or an explicitly documented alternative.
- Implement shared PII masking utility covering PAN, Aadhaar, phone, email, account number, OTP, full name, and address where feasible.
- Implement booking-code generator with DB uniqueness retry up to 5 attempts.
- Add LLM adapter with model names centralized: Gemini 2.5 Flash, Gemini 2.5 Flash-Lite, and Groq fallback only for classification/safety.

Acceptance:
- Schema migrations apply cleanly.
- Unit tests pass for PII masking and booking-code collision retry.
- No code references Gemini 2.0 Flash.

## Phase 2: Review Ingestion and Theme Classification

Goal: automate Google Play review ingestion and weekly Review Pulse generation.

Work:
- Implement `google-play-scraper` adapter and GitHub Actions weekly/manual workflow.
- Store deduped, PII-masked reviews and ingestion run status.
- Implement Python BERTopic pipeline: Gemini embeddings, UMAP, HDBSCAN, c-TF-IDF, 3 Gemini Flash calls for labels/action ideas/summary.
- Store `review_pulse` and `theme_snapshots` for dashboard and scheduler handoff.

Acceptance:
- Duplicate reviews skipped and counted.
- Raw PII never stored.
- Pulse has exactly 5 themes, exactly 3 representative quotes overall (typically one per top-3 theme when substantive quotes exist), 3 action ideas, summary <=250 words.
- Stale/zero-review/no-cluster edge cases preserve previous pulse.

## Phase 3: Smart-Sync FAQ RAG

Goal: ship facts-only FAQ answering from approved sources.

Work:
- Implement approved source manifest and static fee explainer.
- Build Playwright ingestion script for predefined URLs, content-aware chunking, Gemini embeddings, and ChromaDB `smart_sync_kb` upsert.
- Implement metadata-filtered retrieval plus BM25 rerank.
- Implement RAG answer generation with citations and post-generation safety check.
- Add no-results response distinct from advice/PII refusal.

Acceptance:
- Golden retrieval dataset in [docs/evals.md](docs/evals.md) passes faithfulness, relevance, citation, and no-advice checks.
- No runtime web search occurs.
- ChromaDB outage returns source-limited no-results and surfaces admin health error.

## Phase 4: Google FastMCP Integrations

Goal: make real Google Calendar, Sheets, and Gmail draft operations available before scheduler booking flows.

Work:
- Implement Python FastMCP server with Calendar, Sheets, and Gmail draft tools only.
- Implement TypeScript MCP client and adapters.
- Validate OAuth setup and document local/sidecar deployment path.
- Verify Gmail exposes draft creation only, no send tool.

Acceptance:
- Calendar availability read works.
- Calendar hold create/update/cancel works.
- Sheet append/update by booking code works.
- Gmail draft creation works and no auto-send capability exists.
- FastMCP unavailable is surfaced as a partial integration failure path.

## Phase 5: Chat Scheduler and HITL Approval Center

Goal: deliver booking lifecycle with real integrations and admin approval.

Work:
- Implement shared scheduler state machine for `book_new`, `reschedule`, `cancel`, `what_to_prepare`, and `check_availability`.
- Implement canonical theme-aware greeting from DB with required disclaimer.
- Create booking, Calendar hold, Sheet row, Gmail draft, and HITL record after booking.
- Implement secure-details link flow and approval-gated attendee addition.
- Implement pre/post-confirmation cancel and reschedule flows.

Acceptance:
- No PII collected in AI conversation.
- Booking code appears in customer response, Calendar title, Sheet row, Email subject/body, HITL payload.
- Sheet `approval_status` and booking status stay in sync.
- Customer attendee is added only after secure details + Admin approval.

## Phase 6: Voice Scheduler

Goal: add voice as an input/output mode over the same scheduler state machine.

Work:
- Implement Deepgram STT WebSocket streaming and Browser SpeechSynthesis TTS.
- Add Web Speech API/chat fallback for Deepgram failures or credit exhaustion.
- Apply PII masking immediately after transcript finalization.
- Spell booking codes character-by-character and repeat IST dates/times.

Acceptance:
- Voice supports the same 5 scheduler intents as chat.
- Low-confidence transcript asks user to repeat instead of guessing.
- Spoken PII is masked and never repeated.
- Chat/voice mode switch preserves session state.

## Phase 7: Admin Dashboards and Review Trends

Goal: give Admin users operational visibility.

Work:
- Build Review Pulse dashboard, Review Trends dashboard, ingestion health view, HITL Approval Center, FAQ preview, scheduler preview, and Evaluation Suite UI.
- Enforce role-aware navigation: Customer sees only FAQ and Scheduler; Admin sees all modules.
- Surface partial MCP failures with retry actions.

Acceptance:
- Customer cannot access admin modules.
- Admin can retry failed Calendar/Sheet/Gmail integration actions.
- Trend dashboard shows volume, rating, sentiment, emerging/worsening/improving themes.

## Phase 8: Evaluation Suite and Hardening

Goal: prove rules, edge cases, integrations, and cost controls.

Work:
- Implement golden retrieval evals, adversarial safety evals, PII masking evals, booking integration evals, sync evals, voice intent evals, and cost/model static checks.
- Expand eval coverage for PII types missing from current docs: Aadhaar, account number, OTP, full name, address.
- Add checks for no Gemini 2.0 references, ChromaDB active vector DB, no Pinecone use, no email-send tool, and Deepgram fallback.

Acceptance:
- Required safety pass rate: 100%.
- Retrieval evals pass with citations and no advice.
- All required edge cases from [docs/edgeCase.md](docs/edgeCase.md) have either automated tests or documented manual verification.
- Final eval report generated.

## How To Start

Start with Phase 0 only. Do not implement product features yet.

Recommended first working session:
1. Update phase-blocking docs: [docs/architecture.md](docs/architecture.md), [docs/architecture/voiceAgent.md](docs/architecture/voiceAgent.md), [docs/architecture/mcpIntegration.md](docs/architecture/mcpIntegration.md), [docs/architecture/ragA.md](docs/architecture/ragA.md), [docs/edgeCase.md](docs/edgeCase.md), [docs/evals.md](docs/evals.md), [docs/decisions.md](docs/decisions.md), and [.env.example](.env.example).
2. Create or verify project scaffold and folder boundaries.
3. Run a basic startup check.
4. Stop and review Phase 0 diff before starting Phase 1.