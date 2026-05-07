# Groww Ops Intelligence Suite

A unified AI-powered web application for Groww that connects Google Play Store review intelligence, facts-only customer FAQ support, chat and voice advisor scheduling, and human-in-the-loop operations management.

## Architecture

| Module | Description | Access |
|---|---|---|
| **A — Review Intelligence** | Weekly Google Play review ingestion, BERTopic clustering, Review Pulse generation | Admin |
| **B — Review Trends** | Week-over-week trend metrics (volume, rating, sentiment, theme share) | Admin |
| **C — Smart-Sync FAQ** | RAG-powered facts-only FAQ from ~15 predefined official URLs + static fee explainer | Customer, Admin (preview) |
| **D — Advisor Scheduler** | Chat + voice booking via shared state machine, Deepgram STT/TTS, theme-aware greeting | Customer, Admin (preview) |
| **E — HITL Approval Center** | Admin approval for customer-facing confirmation, Calendar/Sheet/Email sync | Admin |
| **F — Evaluation Suite** | Retrieval accuracy, safety, PII, integration, and cost evals | Admin |

## Tech Stack

- **Frontend:** Next.js 14 App Router, React 18, Tailwind CSS 4, Recharts
- **Backend:** Next.js API routes (TypeScript), FastMCP sidecar (Python)
- **App DB:** Supabase free tier (Postgres); SQLite fallback for chat history (See ADR-019)
- **Vector DB:** ChromaDB (local/sidecar, collection `smart-sync-kb`)
- **LLM:** Gemini 2.5 Flash (generation), Gemini 2.5 Flash-Lite (classification/safety), Groq Llama 3.x (fallback)
- **Embeddings:** Gemini gemini-embedding-001 (768-dim)
- **Voice:** Deepgram STT (nova-2) + Deepgram Aura TTS (credit-limited); Web Speech API fallback
- **MCP:** FastMCP for Google Calendar, Google Sheets, Gmail draft integration
- **Clustering:** BERTopic (UMAP + HDBSCAN + c-TF-IDF) in Python, runs via GitHub Actions
- **Hosting:** Vercel free tier (frontend + API) + Supabase free tier (DB)

## Prerequisites

- Node.js 20+
- Python 3.11+ (for clustering pipeline and FastMCP server)
- ChromaDB running locally or as a sidecar (`npm run chroma:local`)
- Gemini API key (free via Google AI Studio)
- Supabase project (free tier) — optional, SQLite fallback available for chat history
- Google Cloud project with Calendar, Sheets, Gmail APIs enabled (free OAuth)
- Deepgram account ($200 signup credits) — optional, Web Speech API fallback available

## Setup

1. **Clone and install:**

```bash
git clone https://github.com/deepanjandhwani/IndMoney-Ops-Intelligence-Suite.git
cd IndMoney-Ops-Intelligence-Suite
npm install
```

2. **Configure environment:**

```bash
cp .env.example .env.local
# Fill in the required values — see .env.example for documentation
```

3. **Start ChromaDB:**

```bash
npm run chroma:local
```

4. **Ingest the RAG knowledge base:**

```bash
npm run phase3:ingest
```

5. **Start the FastMCP server (Google integrations):**

```bash
npm run phase4:mcp
```

6. **Run the dev server:**

```bash
npm run dev
```

7. **Open the app:**

- Customer view: [http://localhost:3000/customer/faq](http://localhost:3000/customer/faq)
- Admin view: [http://localhost:3000/admin](http://localhost:3000/admin)

## Using the Platform

### Customer Side

1. Navigate to any customer page (FAQ, Scheduler, My Bookings).
2. You will be redirected to the **Customer Login** page if not signed in.
3. Click **Create one** to sign up — enter your name, email, and password.
4. You will be auto-signed-in immediately after signup (no email verification needed).
5. Your name and a logout button appear in the sidebar.

### Admin Side

1. Navigate to [/admin](http://localhost:3000/admin) or any admin page.
2. Sign in with the pre-configured admin credentials:
   - **Email:** `admin@gmail.com`
   - **Password:** `admin`
3. The admin dashboard gives access to Review Pulse, Trends, HITL Centre, and Evaluations.

## Google OAuth Setup

The FastMCP server requires Google OAuth credentials for Calendar, Sheets, and Gmail.

1. Create a Google Cloud project (free) and enable Calendar API, Sheets API, Gmail API.
2. Create OAuth 2.0 credentials (Desktop application recommended).
3. Download `credentials.json` to `credentials/credentials.json`.
4. Run the OAuth login flow:

```bash
npm run phase4:oauth-login
```

5. The generated `token.json` is saved to `credentials/token.json`.

See `docs/architecture/mcpIntegration.md` Section 1.2 for full details.

## Environment Variables

All variables are documented in `.env.example`. Key groups:

| Group | Variables | Required |
|---|---|---|
| Gemini | `GEMINI_API_KEY`, model names | Yes |
| Supabase | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | No (SQLite fallback) |
| ChromaDB | `CHROMA_URL`, `CHROMA_COLLECTION` | Yes (for FAQ) |
| FastMCP | `MCP_SERVER_URL`, Google OAuth paths | Yes (for scheduler integrations) |
| Deepgram | `DEEPGRAM_API_KEY` | No (Web Speech API fallback) |
| Groq | `GROQ_API_KEY` | No (Gemini-only is fine) |
| Review ingestion | `GOOGLE_PLAY_PACKAGE_NAME` | Yes (for Module A) |

## GitHub Actions Workflows

### Review Ingestion & Pulse (`.github/workflows/review_ingestion.yml`)

Runs weekly on Monday at 2:00 AM UTC. Ingests Google Play reviews, runs BERTopic clustering, and generates the Review Pulse. Can also be triggered manually via `workflow_dispatch`.

**Required secrets:** `GH_SUPABASE_URL`, `GH_SUPABASE_SERVICE_ROLE_KEY`, `GH_GEMINI_API_KEY`

### Smart-Sync RAG Refresh (`.github/workflows/rag_refresh.yml`)

Runs daily at 10:00 AM IST (04:30 UTC). Re-scrapes predefined source URLs and refreshes the ChromaDB knowledge base. Can also be triggered manually.

**Required secrets:** `GH_GEMINI_API_KEY`, `GH_CHROMA_URL`

## NPM Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start Next.js dev server |
| `npm run build` | Production build |
| `npm run chroma:local` | Start local ChromaDB on port 8001 |
| `npm run phase2:ingest` | Ingest Google Play reviews to Supabase |
| `npm run phase2:cluster` | Run BERTopic clustering + Review Pulse generation |
| `npm run phase2:review-pulse` | Ingest + cluster in sequence |
| `npm run phase3:ingest` | Scrape sources + build ChromaDB knowledge base |
| `npm run phase4:mcp` | Start FastMCP server (Calendar, Sheets, Gmail) |
| `npm run phase4:oauth-login` | Run Google OAuth consent flow |
| `npm run evals:phase3` | Run Module F evaluation suite |
| `npm test` | Run unit tests |
| `npm run typecheck` | TypeScript type check |

## Project Structure

```
app/                    # Next.js App Router pages and API routes
  admin/                # Admin-only pages (review pulse, trends, HITL, evals)
  customer/             # Customer pages (FAQ, scheduler, bookings)
  api/                  # API routes (FAQ, scheduler, HITL, history)
src/
  adapters/             # External service adapters (Supabase, ChromaDB, Deepgram, Google MCP, LLM)
  services/             # Business logic (scheduler state machine, reviews, safety)
  rag/                  # RAG pipeline (scrape, chunk, embed, retrieve, answer, safety)
  ui/                   # Client components
  models/               # Shared types and navigation config
  cli/                  # CLI scripts (review ingestion, RAG ingestion)
  data/                 # Data layer READMEs
config/                 # Source URLs manifest, static fee explainer
scripts/                # Python clustering pipeline, eval runner
mcp/                    # FastMCP Python server for Google integrations
docs/                   # Architecture docs, problem statement, rules, edge cases, evals
  architecture/         # Deep-dive docs (RAG, voice agent, MCP, theme classification)
supabase/               # Database migrations
.github/workflows/      # GitHub Actions (review ingestion, RAG refresh)
```

## Key Architectural Decisions

See `docs/decisions.md` for the full ADR log. Highlights:

- **ADR-001:** ChromaDB (local, free) for vector storage
- **ADR-004/004a:** Deepgram STT + TTS (credit-limited), Web Speech API fallback
- **ADR-005:** Email drafts only, never auto-sent
- **ADR-009:** Gemini 2.5 Flash/Flash-Lite split; Groq llama-3.1-8b-instant/llama-3.3-70b-versatile as fallback
- **ADR-019:** SQLite fallback for chat history when Supabase is unavailable
- **ADR-024:** HTTP batch voice transport (no WebSocket) for Vercel compatibility
- **ADR-025:** LLM fallback behind deterministic regex for scheduler (feature-flagged)

## Documentation

| Document | Path |
|---|---|
| Problem Statement | `docs/problemStatement.md` |
| Architecture | `docs/architecture.md` |
| ADRs | `docs/decisions.md` |
| System Rules | `docs/rules.md` |
| Edge Cases | `docs/edgeCase.md` |
| Evaluation Suite | `docs/evals.md` |
| RAG Architecture | `docs/architecture/ragA.md` |
| Voice Agent | `docs/architecture/voiceAgent.md` |
| MCP Integration | `docs/architecture/mcpIntegration.md` |
| Theme Classification | `docs/architecture/themeClassification.md` |

## Source Manifest (32 Approved Sources)

All FAQ answers come exclusively from these predefined sources. No runtime web search is performed.

| # | Source ID | Scheme / Title | URL |
|---|---|---|---|
| 1 | src_001 | HDFC Defence Fund Direct Growth | https://groww.in/mutual-funds/hdfc-defence-fund-direct-growth |
| 2 | src_002 | HDFC Transportation and Logistics Fund Direct Growth | https://groww.in/mutual-funds/hdfc-transportation-and-logistics-fund-direct-growth |
| 3 | src_003 | HDFC Pharma and Healthcare Fund Direct Growth | https://groww.in/mutual-funds/hdfc-pharma-and-healthcare-fund-direct-growth |
| 4 | src_004 | HDFC Manufacturing Fund Direct Growth | https://groww.in/mutual-funds/hdfc-manufacturing-fund-direct-growth |
| 5 | src_005 | HDFC Mid-Cap Fund Direct Plan Growth Option | https://groww.in/mutual-funds/hdfc-mid-cap-opportunities-fund-direct-growth |
| 6 | src_006 | HDFC Nifty Midcap 150 Index Fund Direct Growth | https://groww.in/mutual-funds/hdfc-nifty-midcap-150-index-fund-direct-growth |
| 7 | src_007 | HDFC Nifty Smallcap 250 Index Fund Direct Growth | https://groww.in/mutual-funds/hdfc-nifty-smallcap-250-index-fund-direct-growth |
| 8 | src_008 | HDFC Nifty Next 50 Index Fund Direct Growth | https://groww.in/mutual-funds/hdfc-nifty-next-50-index-fund-direct-growth |
| 9 | src_009 | HDFC Nifty 100 Equal Weight Index Fund Direct Growth | https://groww.in/mutual-funds/hdfc-nifty-100-equal-weight-index-fund-direct-growth |
| 10 | src_010 | HDFC Small Cap Fund Direct Growth Option | https://groww.in/mutual-funds/hdfc-small-cap-fund-direct-growth |
| 11 | src_011 | HDFC Infrastructure Fund Direct Plan Growth Option | https://groww.in/mutual-funds/hdfc-infrastructure-fund-direct-growth |
| 12 | src_012 | HDFC Nifty50 Equal Weight Index Fund Direct Growth | https://groww.in/mutual-funds/hdfc-nifty50-equal-weight-index-fund-direct-growth |
| 13 | src_013 | HDFC Value Fund Direct Plan Growth | https://groww.in/mutual-funds/hdfc-value-fund-direct-plan-growth |
| 14 | src_014 | HDFC Banking & Financial Services Fund Direct Growth | https://groww.in/mutual-funds/hdfc-banking-financial-services-fund-direct-growth |
| 15 | src_015 | HDFC Large Cap Fund Direct Growth | https://groww.in/mutual-funds/hdfc-large-cap-fund-direct-growth |
| 16 | src_016 | HDFC Focused Fund Direct Growth | https://groww.in/mutual-funds/hdfc-focused-fund-direct-growth |
| 17 | src_017 | HDFC Dividend Yield Fund Direct Growth | https://groww.in/mutual-funds/hdfc-dividend-yield-fund-direct-growth |
| 18 | src_018 | HDFC Multi Cap Fund Direct Growth | https://groww.in/mutual-funds/hdfc-multi-cap-fund-direct-growth |
| 19 | src_019 | HDFC Gold ETF Fund of Fund Direct Growth | https://groww.in/mutual-funds/hdfc-gold-fund-direct-growth |
| 20 | src_020 | HDFC Flexi Cap Fund Direct Growth | https://groww.in/mutual-funds/hdfc-equity-fund-direct-growth |
| 21 | src_021 | HDFC Balanced Advantage Fund Direct Growth | https://groww.in/mutual-funds/hdfc-balanced-advantage-fund-direct-growth |
| 22 | src_022 | HDFC Hybrid Equity Fund Direct Growth | https://groww.in/mutual-funds/hdfc-premier-multi-cap-fund-direct-growth |
| 23 | src_023 | HDFC Large and Mid Cap Fund Direct Growth | https://groww.in/mutual-funds/hdfc-large-and-mid-cap-fund-direct-growth |
| 24 | src_024 | HDFC Technology Fund Direct Growth | https://groww.in/mutual-funds/hdfc-technology-fund-direct-growth |
| 25 | src_025 | HDFC ELSS Tax Saver Fund Direct Plan Growth | https://groww.in/mutual-funds/hdfc-elss-tax-saver-fund-direct-plan-growth |
| 26 | src_026 | HDFC Short Term Debt Fund Direct Growth | https://groww.in/mutual-funds/hdfc-short-term-opportunities-fund-direct-growth |
| 27 | src_027 | HDFC Liquid Fund Direct Growth | https://groww.in/mutual-funds/hdfc-liquid-fund-direct-growth |
| 28 | src_028 | HDFC Overnight Fund Direct Growth | https://groww.in/mutual-funds/hdfc-overnight-fund-direct-growth |
| 29 | src_029 | HDFC Money Market Fund Direct Growth | https://groww.in/mutual-funds/hdfc-money-market-fund-direct-growth |
| 30 | src_030 | HDFC Nifty 50 Index Fund Direct Growth | https://groww.in/mutual-funds/hdfc-nifty-50-index-fund-direct-growth |
| 31 | src_031 | HDFC Corporate Bond Fund Direct Growth | https://groww.in/mutual-funds/hdfc-medium-term-opportunities-fund-direct-growth |
| 32 | fee_static_001 | Groww — Expense Ratio (approved educational explainer) | `config/static_fee_explainer.md` |

For the full categorized manifest, see [docs/source-manifest.md](docs/source-manifest.md).

## Cost

All services run on free tiers or credit-limited free credits. No paid service is required. See `docs/decisions.md` for per-component cost analysis.

| Service | Cost |
|---|---|
| Gemini API | Free tier |
| Supabase | Free tier (500 MB) |
| ChromaDB | Free (local) |
| Vercel | Free tier |
| GitHub Actions | Free (2,000 min/month private, unlimited public) |
| Deepgram | $200 signup credits (credit-limited) |
| Groq | Free tier |
