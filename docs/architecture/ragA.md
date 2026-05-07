# RAG Architecture — Smart-Sync Knowledge Base (Module C)

> Resolves: ADR-002 (Embedding model), ADR-007 (Vector index type), ADR-009 (LLM model-per-task: Gemini 2.0 Flash retired; uses Gemini 2.5 Flash / Flash-Lite)
> Cost target: **$0** — every component must be free tier or fully local.

---

## 1. Embedding Model Selection

### 1.1 Candidates Evaluated

| Model | Type | Dims | MTEB Retrieval (NDCG@10) | Free Tier Limits | Latency | GPU Required |
|---|---|---|---|---|---|---|
| **Gemini gemini-embedding-001** | API | 768 output | Current Gemini embedding model | Free tier via Gemini API / AI Studio | ~80–150 ms/req | No |
| Cohere embed-v3.0 | API | 1024 | ~65.4 | 1,000 calls/month | ~100–200 ms/req | No |
| Voyage AI voyage-3-lite | API | 512 | ~67.0 | 50M tokens/month | ~100–180 ms/req | No |
| all-MiniLM-L6-v2 | Local | 384 | ~51.8 | Unlimited (local) | ~5–15 ms/chunk (CPU) | No |
| bge-small-en-v1.5 | Local | 384 | ~51.7 | Unlimited (local) | ~5–15 ms/chunk (CPU) | No |

### 1.2 Evaluation Criteria for This Corpus

**Corpus profile:**
- ~15 scraped URLs (scheme factsheets, SIDs, AMFI/SEBI pages, help pages)
- 1 static fee explainer document
- Estimated total: ~200–400 chunks
- Queries: English with occasional Hindi terms (e.g., "exit load kya hai")
- Ingestion is one-time + periodic re-scrape, not continuous

**What matters most:**
1. Retrieval quality — must distinguish "exit load" from "expense ratio" from "lock-in period" in tightly related financial content
2. Free tier headroom — ingestion is rare (~400 embeddings), queries are moderate (capstone demo)
3. No GPU — embedding and retrieval code can run on developer laptop or Vercel serverless, while ChromaDB itself runs as the local/sidecar vector service from ADR-001 and ADR-006
4. Hindi-mixed query handling — occasional transliterated Hindi

### 1.3 Analysis

**Gemini gemini-embedding-001** — Best fit.
- Current Gemini embedding model available to this project API key.
- 768-dimensional output keeps ChromaDB storage small for a ~400-chunk corpus.
- 10M tokens/minute free tier means query-time embedding is effectively unlimited for this scale.
- Multilingual support handles Hindi-mixed queries natively.
- 768 dimensions: good balance between quality and storage.
- No GPU, no local model download, no Python dependency.

**Cohere embed-v3.0** — Eliminated.
- 1,000 calls/month is the hard constraint. With 400 chunks for ingestion + ~100 queries during demo, the limit is tight with no room for re-ingestion or iteration during development.
- Quality is comparable but the monthly cap makes it fragile for a development project.

**Voyage AI voyage-3-lite** — Eliminated.
- Strong retrieval quality (~67.0 NDCG@10) and generous free tier (50M tokens/month).
- However, the model is now deprecated in favor of voyage-4-lite. Relying on a deprecated model for a capstone is risky.
- Additional API key signup + vendor lock adds operational complexity for marginal quality gain.

**all-MiniLM-L6-v2** — Eliminated.
- 14-point retrieval quality gap vs Gemini (51.8 vs 66.0) is significant for a corpus where "exit load," "expense ratio," and "lock-in" are semantically close.
- Requires `sentence-transformers` + PyTorch (~2GB install), adding a Python runtime dependency to a TypeScript project.
- Would require a Python sidecar process or ONNX conversion.
- No multilingual support — Hindi-mixed queries would fail.

**bge-small-en-v1.5** — Eliminated.
- Same quality and dependency issues as all-MiniLM-L6-v2.
- Marginally better on some benchmarks but same architectural mismatch (Python dependency in TypeScript project).

### 1.4 Decision

**Selected: Gemini gemini-embedding-001**

| Property | Value |
|---|---|
| Dimensions | 768 |
| MTEB Retrieval NDCG@10 | ~66.0 |
| Free tier | 1,500 RPM, 10M TPM, no daily cap on requests |
| Latency | ~80–150 ms per request |
| GPU required | No |
| Multilingual | Yes (Hindi-mixed queries supported) |
| SDK | `@google/generative-ai` (TypeScript native) |
| Cost | **$0** |

> **Cost flag: FREE.** Gemini embedding API is free tier with no credit card required.

---

## 2. Chunking Strategy

### 2.1 Why Fixed-Size Chunking Fails for This Corpus

Fixed-size chunking (e.g., 512-token sliding window) is inappropriate for this corpus because:

1. **Scheme factsheets** have structured sections (Exit Load, Expense Ratio, Lock-in, Benchmark). A fixed window can split a 3-line exit load section across two chunks, making neither chunk self-contained.
2. **Fee explainer** has distinct scenarios (exit load charged, expense ratio deducted, stamp duty). Mixing two fee scenarios in one chunk produces ambiguous retrieval results.
3. **Help pages** have numbered steps (Step 1, Step 2…). Splitting mid-step creates orphan fragments.
4. **Metadata tagging** is impossible with fixed windows — you cannot tag a chunk with `section_type: "exit_load"` if the chunk contains half exit-load and half expense-ratio.

### 2.2 Content-Aware Chunking Scheme

#### Scheme Factsheets / SIDs

| Property | Value |
|---|---|
| Split strategy | By section heading (H2/H3 boundaries) |
| Max tokens per chunk | 400 |
| Overflow handling | If a section exceeds 400 tokens, split at paragraph boundary |
| Metadata tags | `scheme_name`, `section_type`, `source_url`, `last_checked` |

`section_type` values: `exit_load`, `expense_ratio`, `lock_in`, `benchmark`, `riskometer`, `min_sip`, `fund_objective`, `nav`, `aum`, `general`

#### Fee Explainer

| Property | Value |
|---|---|
| Split strategy | By fee scenario (each scenario = one chunk) |
| Max tokens per chunk | 300 |
| Overflow handling | Rare — fee scenarios are concise. If exceeded, split at sentence boundary. |
| Metadata tags | `fee_type`, `scenario`, `source_id` = `fee_static_001` |

`fee_type` values: `exit_load`, `expense_ratio`, `stamp_duty`, `transaction_charge`, `gst`, `stt`, `general_fee`

#### AMFI / SEBI Educational Pages

| Property | Value |
|---|---|
| Split strategy | By concept paragraph or FAQ item |
| Max tokens per chunk | 400 |
| Overflow handling | Split at sentence boundary |
| Metadata tags | `content_type` = `regulatory_education`, `source_url`, `last_checked`, `topic` |

#### Help / Process Pages

| Property | Value |
|---|---|
| Split strategy | By step or section (e.g., "Step 1: Log in…") |
| Max tokens per chunk | 400 |
| Overflow handling | Split at step boundary |
| Metadata tags | `content_type` = `help_page`, `source_url`, `last_checked`, `topic` |

### 2.3 Chunk Document Interface

```typescript
interface ChunkDocument {
  id: string;                    // deterministic: hash(source_id + section_index)
  text: string;                  // chunk content, max 400 tokens
  metadata: ChunkMetadata;
}

interface ChunkMetadata {
  source_id: string;             // e.g., "src_001", "fee_static_001"
  source_type: SourceType;       // "official_url" | "static_fee_explainer"
  content_type: ContentType;     // "scheme_fact" | "fee_explanation" | "regulatory_education" | "help_page"
  title: string;                 // human-readable source title
  url: string | null;            // source URL, null for fee explainer
  last_checked: string;          // ISO date: "2026-04-26"
  content_hash: string;          // deterministic hash of scraped/ingested source content
  scheme_name?: string;          // only for scheme factsheets
  section_type?: string;         // only for scheme factsheets (exit_load, expense_ratio, etc.)
  fee_type?: string;             // only for fee explainer chunks
  scenario?: string;             // only for fee explainer chunks
  topic?: string;                // for help pages and regulatory content
  chunk_index: number;           // position within source document
}

type SourceType = "official_url" | "static_fee_explainer";
type ContentType = "scheme_fact" | "fee_explanation" | "regulatory_education" | "help_page";
```

### 2.4 Chunk Metadata JSON Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "ChunkMetadata",
  "type": "object",
  "required": [
    "source_id", "source_type", "content_type",
    "title", "last_checked", "content_hash", "chunk_index"
  ],
  "properties": {
    "source_id": { "type": "string" },
    "source_type": { "enum": ["official_url", "static_fee_explainer"] },
    "content_type": {
      "enum": [
        "scheme_fact", "fee_explanation",
        "regulatory_education", "help_page"
      ]
    },
    "title": { "type": "string" },
    "url": { "type": ["string", "null"] },
    "last_checked": { "type": "string", "format": "date" },
    "content_hash": { "type": "string" },
    "scheme_name": { "type": "string" },
    "section_type": { "type": "string" },
    "fee_type": { "type": "string" },
    "scenario": { "type": "string" },
    "topic": { "type": "string" },
    "chunk_index": { "type": "integer", "minimum": 0 }
  }
}
```

---

## 3. Vector Store Design — ChromaDB

> Per ADR-001: ChromaDB, fully local for the capstone demo, free, no paid cloud dependency. Hosted deployment requires a free sidecar service or a new ADR.

### 3.1 Collection Structure

**Single collection with metadata-based partitioning**, not multiple collections.

| Property | Value |
|---|---|
| Collection name | `smart-sync-kb` |
| Embedding function | Gemini gemini-embedding-001 (via custom ChromaDB embedding function) |
| Distance metric | Cosine similarity (`cosine`) |
| Total documents | ~200–400 chunks |

**Why single collection:**
- ChromaDB's `where` filter is efficient on small collections.
- Multiple collections (for example, separate FAQ and fee collections) require the agent to decide which collection to search before searching. A single collection with metadata filters lets the retrieval layer combine results from scheme facts and fee explanations in one query when needed (e.g., "What is exit load and why was I charged?").
- The top-level architecture and ADR-012 use this single-collection design as the canonical ChromaDB structure.

### 3.2 ChromaDB Metadata Filtering

ChromaDB supports `where` filters on metadata fields using operators:

```typescript
// Exact match
{ content_type: "scheme_fact" }

// Logical AND
{ $and: [
  { content_type: "scheme_fact" },
  { scheme_name: "Axis ELSS Fund" }
]}

// Logical OR
{ $or: [
  { content_type: "scheme_fact" },
  { content_type: "fee_explanation" }
]}

// Combined filter + similarity search
collection.query({
  queryEmbeddings: [queryVector],
  nResults: 10,
  where: { content_type: "scheme_fact" }
})
```

### 3.3 Combining Metadata Filtering with Similarity Search

ChromaDB applies the `where` filter first (reducing the candidate set), then ranks the filtered candidates by cosine similarity. This is critical for this corpus:

1. **Scheme-specific queries** → filter by `content_type: "scheme_fact"` + optional `scheme_name`, then rank by similarity
2. **Fee queries** → filter by `content_type: "fee_explanation"`, then rank by similarity
3. **Multi-source queries** (e.g., "exit load and why I was charged") → use `$or` filter across `scheme_fact` and `fee_explanation`, then rank by similarity
4. **Process/help queries** → filter by `content_type: "help_page"`, then rank by similarity

This ensures scheme facts never compete with help page text for the same similarity slots, preventing irrelevant chunks from diluting results.

### 3.4 ChromaDB Collection Interface

```typescript
interface ChromaDBConfig {
  collectionName: "smart-sync-kb";
  embeddingModel: "gemini-embedding-001";
  embeddingDimensions: 768;
  distanceMetric: "cosine";
}

interface ChromaQueryParams {
  queryText: string;
  nResults: number;         // top-k, default 10
  where?: Record<string, unknown>;
  whereDocument?: Record<string, unknown>;
}

interface ChromaQueryResult {
  ids: string[];
  documents: string[];
  metadatas: ChunkMetadata[];
  distances: number[];      // cosine distances (lower = more similar)
}
```

---

## 4. Hybrid Retrieval Strategy

### 4.1 Why Hybrid Beats Pure Cosine for This Corpus

Pure cosine similarity fails on this corpus because:

1. **Term precision matters.** "Exit load" and "expense ratio" are semantically similar (both are "charges related to mutual funds") but factually different. A user asking about exit load should never get expense ratio chunks. BM25 keyword matching enforces term precision.
2. **Numerical/specific terms.** Queries like "1% exit load" or "3-year lock-in" contain specific values that cosine similarity may not weigh heavily, but BM25 will boost chunks containing those exact terms.
3. **Hindi transliteration.** A query like "exit load kya hai" benefits from BM25 matching "exit load" as a keyword even if the embedding model handles "kya hai" imperfectly.

Hybrid retrieval uses cosine for semantic relevance + BM25 for term precision.

### 4.2 Retrieval Pipeline Steps

```
Step 0: Pronoun Resolution / Query Rewrite (if pronouns detected + history exists)
    ↓
Step 1: Query Classification (cheapest LLM) + Fund Filter Application
    ↓
Step 2: Metadata-Filtered Vector Search (ChromaDB)
    ↓
Step 3: BM25 Keyword Rerank on top-k
    ↓
Step 4: Context Assembly with Citations + Conversation History Injection
```

#### Step 0: Pronoun Resolution / Query Rewrite (See ADR-020)

**Model:** Gemini 2.5 Flash-Lite (same model as classification)

**Purpose:** When a follow-up question uses pronouns ("this fund", "its NAV", "that one", "the fund"), the embedding would be vague and match poorly. This step rewrites the query to be self-contained using the last 4 conversation turns.

**Trigger:** Only fires when both conditions are met: (1) conversation history is non-empty, and (2) the PII-masked query matches the pronoun pattern (`/\b(this|that|its|it|the fund|above|previous|same|those|these)\b/i`). When not triggered, the original query passes through unchanged.

**Fallback:** If the LLM returns garbage or a very short rewrite (<5 chars), the original query is used.

> **Cost flag: FREE.** Gemini 2.5 Flash-Lite free tier. ~100 tokens per rewrite call. Only called for pronoun-bearing queries.

#### Step 0b: Fund Filter Application (See ADR-021)

When the user has selected funds via the filter bar (Fund Type / Risk Profile / Fund Name chips), the classification result is overridden to scope `extracted_scheme_name` to the selected fund names. This ensures ChromaDB retrieval is limited to the relevant funds even for broad or comparative questions.

#### Step 1: Query Classification

**Model:** Cheapest LLM — Gemini 2.5 Flash-Lite (free: 15 RPM, 1,000 RPD) or Groq Llama 3 (free: 30 RPM)

**Purpose:** Classify the (possibly rewritten) query into a retrieval category to select the correct metadata filter.

```typescript
type QueryCategory =
  | "scheme_fact"          // e.g., "What is the exit load for Axis ELSS?"
  | "fee_explanation"      // e.g., "Why was I charged an exit load?"
  | "process_help"         // e.g., "How to download capital gains statement?"
  | "regulatory_education" // e.g., "What is ELSS lock-in period?"
  | "multi_source"         // e.g., "What is exit load and why was I charged?"
  | "out_of_scope";        // e.g., "Which fund should I buy?"

interface QueryClassification {
  category: QueryCategory;
  extracted_scheme_name: string | null;
  extracted_fee_type: string | null;
  extracted_topic: string | null;
  confidence: number;      // 0.0 – 1.0
}
```

**Classification prompt (pseudocode):**

```
Given a customer question about mutual funds, classify it:

Categories:
- scheme_fact: question about a specific scheme's factual attributes
- fee_explanation: question about why a fee/charge applies
- process_help: question about how to do something (download, update, etc.)
- regulatory_education: question about general MF concepts (ELSS, SIP, etc.)
- multi_source: question that needs both scheme facts AND fee explanation
- out_of_scope: investment advice, recommendations, PII requests

Also extract:
- scheme_name: if a specific fund/scheme is mentioned
- fee_type: if a specific fee type is mentioned
- topic: if a process topic is mentioned

Question: {user_query}
Return JSON.
```

> **Cost flag: FREE.** Gemini 2.5 Flash-Lite free tier. ~50 tokens per classification call.

#### Step 2: Metadata-Filtered Vector Search

Based on the classification, apply the appropriate `where` filter:

```typescript
function buildMetadataFilter(classification: QueryClassification): Record<string, unknown> {
  switch (classification.category) {
    case "scheme_fact":
      const filter: Record<string, unknown> = { content_type: "scheme_fact" };
      if (classification.extracted_scheme_name) {
        return { $and: [filter, { scheme_name: classification.extracted_scheme_name }] };
      }
      return filter;

    case "fee_explanation":
      return { content_type: "fee_explanation" };

    case "process_help":
      return { content_type: "help_page" };

    case "regulatory_education":
      return { content_type: "regulatory_education" };

    case "multi_source":
      return {
        $or: [
          { content_type: "scheme_fact" },
          { content_type: "fee_explanation" }
        ]
      };

    case "out_of_scope":
      return {};  // will be caught by safety check before reaching here
  }
}
```

Query ChromaDB with the filter:

```typescript
const results = await collection.query({
  queryEmbeddings: [await embedQuery(userQuery)],
  nResults: 10,
  where: buildMetadataFilter(classification)
});
```

> **Cost flag: FREE.** ChromaDB is local. Embedding the query costs one Gemini API call (~free).

#### Step 3: BM25 Keyword Rerank on Top-K

After vector search returns top-10 candidates, apply BM25 scoring to rerank:

```typescript
import { BM25 } from "bm25-ts";  // or custom implementation

function bm25Rerank(
  query: string,
  candidates: ChromaQueryResult,
  topK: number = 5
): RerankedResult[] {
  const bm25 = new BM25(candidates.documents);
  const bm25Scores = bm25.score(query);

  const combined = candidates.documents.map((doc, i) => ({
    document: doc,
    metadata: candidates.metadatas[i],
    cosineScore: 1 - candidates.distances[i],  // convert distance to similarity
    bm25Score: bm25Scores[i],
    // weighted combination: 70% cosine, 30% BM25
    combinedScore: 0.7 * (1 - candidates.distances[i]) + 0.3 * normalize(bm25Scores[i])
  }));

  return combined
    .sort((a, b) => b.combinedScore - a.combinedScore)
    .slice(0, topK);
}
```

**Weights (70% cosine / 30% BM25):** Cosine captures semantic meaning, BM25 enforces keyword precision. The 70/30 split favors semantic understanding but prevents term-mismatch errors.

> **Cost flag: FREE.** BM25 is a local algorithm, no API calls.

#### Step 4: Context Assembly with Citations

Assemble the top-k reranked chunks into a context block for the LLM:

```typescript
interface AssembledContext {
  chunks: {
    text: string;
    source_url: string | null;
    source_id: string;
    last_checked: string;
    content_type: ContentType;
  }[];
  total_chunks: number;
  query_category: QueryCategory;
}
```

---

## 5. Agentic RAG Design

### 5.1 Three Retrieval Tools

The agentic RAG system exposes three specialized retrieval tools. Each tool wraps the hybrid retrieval pipeline (Section 4) with pre-configured metadata filters.

```typescript
interface ToolResult {
  chunks: {
    text: string;
    source_url: string | null;
    source_id: string;
    last_checked: string;
    content_type: ContentType;
    relevance_score: number;
  }[];
  total_found: number;
  query_used: string;
}

// Tool 1: Scheme facts retrieval
async function search_scheme_facts(
  query: string,
  scheme_name?: string
): Promise<ToolResult> {
  // Filters: content_type = "scheme_fact"
  // Optional: scheme_name filter for scheme-specific queries
  // Returns top-5 chunks from hybrid retrieval
}

// Tool 2: Fee explainer retrieval
async function search_fee_explainer(
  query: string,
  fee_scenario?: string
): Promise<ToolResult> {
  // Filters: content_type = "fee_explanation"
  // Optional: fee_type filter for scenario-specific queries
  // Returns top-5 chunks from hybrid retrieval
}

// Tool 3: Process/help retrieval
async function search_process_help(
  query: string,
  topic?: string
): Promise<ToolResult> {
  // Filters: content_type in ["help_page", "regulatory_education"]
  // Optional: topic filter
  // Returns top-5 chunks from hybrid retrieval
}
```

### 5.2 Tool JSON Schemas

```json
{
  "tools": [
    {
      "name": "search_scheme_facts",
      "description": "Search the knowledge base for mutual fund scheme facts like exit load, expense ratio, lock-in period, benchmark, riskometer, NAV, AUM, and minimum SIP.",
      "parameters": {
        "type": "object",
        "required": ["query"],
        "properties": {
          "query": {
            "type": "string",
            "description": "The factual question about a mutual fund scheme"
          },
          "scheme_name": {
            "type": "string",
            "description": "Optional: specific scheme name to narrow results"
          }
        }
      }
    },
    {
      "name": "search_fee_explainer",
      "description": "Search the approved fee explanation knowledge base for information about why fees and charges apply, including exit load, expense ratio, stamp duty, STT, and transaction charges.",
      "parameters": {
        "type": "object",
        "required": ["query"],
        "properties": {
          "query": {
            "type": "string",
            "description": "The question about fee or charge explanation"
          },
          "fee_scenario": {
            "type": "string",
            "description": "Optional: specific fee scenario like exit_load, expense_ratio, stamp_duty"
          }
        }
      }
    },
    {
      "name": "search_process_help",
      "description": "Search for help with processes like downloading statements, updating nominee, KYC steps, and other account operations.",
      "parameters": {
        "type": "object",
        "required": ["query"],
        "properties": {
          "query": {
            "type": "string",
            "description": "The question about a process or how-to"
          },
          "topic": {
            "type": "string",
            "description": "Optional: topic area like statements, nominee, kyc"
          }
        }
      }
    }
  ]
}
```

### 5.3 Agent Loop — Pseudocode

```
FUNCTION agenticRAG(user_query: string): FAQAnswer

  // ── Step 1: Classify query (cheapest LLM) ──────────────
  classification = classifyQuery(user_query)
  //   Model: Gemini 2.5 Flash-Lite (free) or Groq Llama 3 (free)
  //   Cost: FREE

  IF classification.category == "out_of_scope":
    RETURN refusalResponse()
    //   "I can't provide investment advice, future return predictions,
    //   or handle personal account information..."

  // ── Step 2: Call primary retrieval tool ─────────────────
  primary_results = CASE classification.category OF
    "scheme_fact"          → search_scheme_facts(user_query, classification.extracted_scheme_name)
    "fee_explanation"      → search_fee_explainer(user_query, classification.extracted_fee_type)
    "process_help"         → search_process_help(user_query, classification.extracted_topic)
    "regulatory_education" → search_process_help(user_query, classification.extracted_topic)
    "multi_source"         → search_scheme_facts(user_query, classification.extracted_scheme_name)
  END CASE

  // ── Step 3: Evaluate sufficiency ────────────────────────
  all_chunks = primary_results.chunks

  IF classification.category == "multi_source"
      OR isSufficient(all_chunks, user_query) == false:

    // ── Step 4: Call secondary tool if needed ────────────
    secondary_results = CASE classification.category OF
      "multi_source"    → search_fee_explainer(user_query, classification.extracted_fee_type)
      "scheme_fact"     → search_fee_explainer(user_query)   // fee context might help
      "fee_explanation" → search_scheme_facts(user_query)    // scheme context might help
      DEFAULT           → null
    END CASE

    IF secondary_results != null:
      all_chunks = merge(all_chunks, secondary_results.chunks)

  // ── Step 5: Sufficiency gate ────────────────────────────
  // Spec defers to §5.4 — top score must be ≥ 0.4 AND at least one chunk ≥ 0.5.
  IF all_chunks.length == 0 OR isSufficient(all_chunks, user_query) == false:
    RETURN noResultsResponse()
    //   "I don't have enough information from approved sources
    //    to answer this question. You can try rephrasing, or
    //    ask about exit load, expense ratio, lock-in, benchmark,
    //    riskometer, fee explanation, or statement download steps."

  // ── Step 6: Assemble answer with citations (best free LLM) ─
  answer = generateAnswer(user_query, all_chunks)
  //   Model: Gemini 2.5 Flash (free, good quality)
  //   Prompt: facts-only, max 6 bullets, cite source_url + last_checked
  //   Cost: FREE

  // ── Step 7: Safety check (cheapest LLM) ────────────────
  safety_result = safetyCheck(answer)
  //   Model: Gemini 2.5 Flash-Lite or Groq Llama 3 (cheapest available)
  //   Checks: no advice, no predictions, no PII, citations present
  //   Cost: FREE

  IF safety_result.passed == false:
    RETURN refusalResponse()

  // ── Step 8: Return ──────────────────────────────────────
  RETURN answer

END FUNCTION
```

### 5.4 Sufficiency Evaluation

```typescript
function isSufficient(chunks: ToolResult["chunks"], query: string): boolean {
  if (chunks.length === 0) return false;
  if (chunks[0].relevance_score < 0.4) return false;

  // At least one chunk must have relevance > 0.5
  const hasStrongMatch = chunks.some(c => c.relevance_score > 0.5);
  return hasStrongMatch;
}
```

**When to stop retrieving:**
- After primary tool if sufficiency check passes (single-source queries)
- After secondary tool for `multi_source` queries (maximum two tool calls)
- Hard cap: never call more than 2 retrieval tools per query (prevents infinite loops)

### 5.5 Multi-Hop Example

**Query:** "What is the exit load for the ELSS fund and why was I charged it?"

```
1. classifyQuery → category: "multi_source",
                    extracted_scheme_name: null (ELSS is a category, not a scheme),
                    extracted_fee_type: "exit_load"

2. search_scheme_facts("exit load ELSS fund")
   → Retrieves chunks about ELSS lock-in period and exit load rules
     from scheme factsheet.
     Source: src_003 (scheme factsheet URL)

3. isSufficient → true for exit load fact, but category is multi_source,
   so secondary tool is called regardless.

4. search_fee_explainer("why charged exit load", fee_scenario: "exit_load")
   → Retrieves fee explanation chunks about when exit load triggers,
     how it is calculated, redemption before lock-in.
     Source: fee_static_001

5. merge chunks from both tools (deduplicated by chunk ID)

6. generateAnswer with merged context:
   "• ELSS funds have a mandatory 3-year lock-in period...
    • Exit load of 1% may apply if redeemed before...
    • The exit load is charged because...
    Sources: [scheme factsheet URL] (Last checked: 2026-04-26),
             fee_static_001 (Last checked: 2026-04-26)"

7. safetyCheck → passed (no advice, citations present)

8. Return answer
```

### 5.6 No-Results Handling

When retrieval returns zero chunks or all chunks score below the relevance threshold:

```typescript
interface NoResultsResponse {
  answer: string;
  sources: [];
  status: "no_results";
}

const NO_RESULTS_MESSAGE =
  "I don't have enough information from approved sources to answer " +
  "this question. I can help with facts about exit load, expense ratio, " +
  "lock-in period, benchmark, riskometer, fee explanations, or " +
  "statement download steps.";
```

Per `edgeCase.md`: "Question matches no chunk in vector store → return a source-limited no-results response, do not hallucinate answer." This is distinct from the exact safety refusal used for advice, prediction, or PII violations.

---

## 6. Citation Assembly

### 6.1 Citation Interface

```typescript
interface Citation {
  source_url: string | null;  // null for fee explainer
  source_id: string;          // e.g., "src_001" or "fee_static_001"
  source_title: string;
  last_checked: string;       // ISO date
  content_type: ContentType;
}

interface FAQAnswer {
  answer: string;             // max 6 bullets, facts-only
  citations: Citation[];      // one per claim-supporting chunk
  status: "answered" | "refused" | "no_results";
}
```

### 6.2 Citation Rules

Per `rules.md` Citation Rules:

| Source Type | Citation Format |
|---|---|
| Official URL chunks | `source_url` = full URL, `last_checked` = scrape date |
| Fee explainer chunks | `source_id` = `fee_static_001`, `url` = `null`, `last_checked` = ingestion date |
| No-URL chunks | `source_id` present, `url` = `null`, note in answer: "Source: Approved internal explainer" |

### 6.3 Citation Assembly Logic

```typescript
function assembleCitations(chunks: ToolResult["chunks"]): Citation[] {
  const seen = new Set<string>();
  const citations: Citation[] = [];

  for (const chunk of chunks) {
    const key = chunk.source_id;
    if (seen.has(key)) continue;
    seen.add(key);

    citations.push({
      source_url: chunk.source_url,
      source_id: chunk.source_id,
      source_title: chunk.metadata?.title ?? "Unknown source",
      last_checked: chunk.last_checked,
      content_type: chunk.content_type
    });
  }

  return citations;
}
```

### 6.4 Answer Generation Prompt (Relevant Section)

```
Rules for your answer:
- Maximum 6 bullet points
- Facts only — no investment advice, no predictions, no recommendations
- Every factual claim must cite its source
- For official URL sources: cite as "Source: [title](url) — Last checked: YYYY-MM-DD"
- For fee explainer: cite as "Source: Approved Fee Explainer (fee_static_001) — Last checked: YYYY-MM-DD"
- If a chunk has no URL, cite as "Source: [title] (internal) — Last checked: YYYY-MM-DD"
- Do not add information not present in the provided context
```

---

## 7. Safety Check (Post-Retrieval, Pre-Response)

### 7.1 Design

**Model:** Cheapest LLM — Gemini 2.5 Flash-Lite (free: 15 RPM, 1,000 RPD) or Groq Llama 3 (free: 30 RPM)

The safety check runs after the answer is generated but before it is returned to the customer.

> **Cost flag: FREE.** ~100 tokens per safety check call.

### 7.2 Safety Check Interface

```typescript
interface SafetyCheckInput {
  user_query: string;
  generated_answer: string;
  citations: Citation[];
}

interface SafetyCheckResult {
  passed: boolean;
  failed_checks: SafetyViolation[];
}

type SafetyViolation =
  | "contains_advice"       // buy/sell/hold, fund recommendation
  | "contains_prediction"   // return prediction, performance guarantee
  | "contains_pii"          // PAN, Aadhaar, phone, email, account number
  | "missing_citation"      // factual claim without source
  | "hallucination_risk";   // answer contains info not in retrieved chunks
```

### 7.3 Safety Check Prompt

```
You are a safety checker for a mutual fund FAQ system.

Check the following answer for violations:

1. ADVICE: Does the answer contain buy/sell/hold advice, fund recommendations,
   portfolio advice, or performance guarantees? → FAIL
2. PREDICTION: Does the answer predict returns, future NAV, or market
   movements? → FAIL
3. PII: Does the answer contain or request PAN, Aadhaar, phone, email,
   account number, OTP, full name, or address? → FAIL
4. CITATION: Does every factual claim have a source citation? → FAIL if missing

User question: {user_query}
Generated answer: {generated_answer}
Citations provided: {citations_json}

Return JSON:
{
  "passed": true/false,
  "failed_checks": []  // list of violation types if any
}
```

### 7.4 Refusal Message

When safety check fails, return the exact refusal from `rules.md`:

```typescript
const SAFETY_REFUSAL =
  "I can't provide investment advice, future return predictions, or handle " +
  "personal account information. I can help with facts from approved " +
  "sources, such as NAV, AUM, exit load, expense ratio, lock-in, benchmark, " +
  "riskometer, historic returns, fund manager, rating, fee explanation, " +
  "or statement download steps. " +
  "For investor education, see https://investor.sebi.gov.in/.";
```

---

## 8. Ingestion Pipeline

### 8.1 Pipeline Overview

```
Source Manifest (config/source_urls.json)
    ↓
Playwright Scraper (fetch HTML from ~15 URLs)
    ↓
Content Parser (extract text, detect sections)
    ↓
Chunker (content-aware splitting per Section 2)
    ↓
Embedder (Gemini gemini-embedding-001)
    ↓
ChromaDB Upsert (smart-sync-kb collection)
    ↓
Stale Chunk Detection + Cleanup
```

The automated refresh is `.github/workflows/rag_refresh.yml`. It runs daily at 10:00 AM IST (`30 4 * * *` UTC) and can also be triggered manually with `workflow_dispatch`. The workflow executes `npm run phase3:ingest`, so `GH_CHROMA_URL` must point to the same reachable ChromaDB sidecar used by the app and `GH_GEMINI_API_KEY` must be configured in GitHub repository secrets.

### 8.2 File Structure

```
src/rag/
├── ingest.ts        # Orchestrates full ingestion pipeline
├── chunk.ts         # Content-aware chunking logic (token-aware caps)
├── gemini.ts        # Gemini embedding + classify/generate/safety adapter
├── retrieve.ts      # Hybrid retrieval (vector + BM25 rerank, cross-domain second hop)
├── faq.ts           # End-to-end FAQ orchestration (classify → retrieve → generate → safety)
├── classify.ts      # Query classification + metadata filter builder
├── safety.ts        # Pre/post-generation safety guardrails
├── answer.ts        # Cited-answer generation + post-gen safety call
├── citations.ts     # Citation assembly + required-citation enforcement
├── manifest.ts      # Source manifest + frontmatter loader
├── chroma.ts        # ChromaDB vector store wrapper
└── types.ts         # Shared TypeScript interfaces
```

### 8.3 Ingestion Orchestrator

```typescript
// src/rag/ingest.ts

interface IngestionConfig {
  sourceManifestPath: string;  // config/source_urls.json
  feeExplainerPath: string;   // config/static_fee_explainer.md
  chromaCollection: string;    // "smart-sync-kb"
  forceReIngest: boolean;      // re-scrape even if content unchanged
}

interface IngestionResult {
  total_sources: number;
  sources_scraped: number;
  sources_failed: number;
  chunks_created: number;
  chunks_upserted: number;
  stale_chunks_removed: number;
  errors: { source_id: string; error: string }[];
  duration_ms: number;
}

async function runIngestion(config: IngestionConfig): Promise<IngestionResult> {
  // 1. Load source manifest
  // 2. For each URL: scrape with Playwright
  // 3. Parse HTML → extract text sections
  // 4. Chunk with content-aware strategy (Section 2)
  // 5. Embed chunks via Gemini gemini-embedding-001
  // 6. Upsert into ChromaDB with metadata
  // 7. Detect and remove stale chunks
  // 8. Return ingestion report
}
```

### 8.4 Source Manifest Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "SourceManifest",
  "type": "object",
  "required": ["sources"],
  "properties": {
    "sources": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["source_id", "url", "source_type", "content_type", "title"],
        "properties": {
          "source_id": { "type": "string" },
          "url": { "type": ["string", "null"] },
          "source_type": { "enum": ["official_url", "static_fee_explainer"] },
          "content_type": {
            "enum": ["scheme_fact", "fee_explanation", "regulatory_education", "help_page"]
          },
          "title": { "type": "string" },
          "scheme_name": { "type": "string" },
          "last_checked": { "type": "string", "format": "date" },
          "scrape_status": { "enum": ["success", "failed", "pending"] }
        }
      }
    }
  }
}
```

### 8.5 Re-Ingestion on Update

```typescript
async function shouldReIngest(
  sourceId: string,
  newContentHash: string,
  collection: ChromaCollection
): Promise<boolean> {
  const existing = await collection.get({
    where: { source_id: sourceId },
    limit: 1
  });

  if (existing.ids.length === 0) return true;

  const existingHash = existing.metadatas[0]?.content_hash;
  return existingHash !== newContentHash;
}
```

On re-ingestion:
1. Scrape the URL again via Playwright
2. Compute content hash of new scraped text
3. Compare with stored `content_hash` in ChromaDB metadata
4. If changed: delete all old chunks for that `source_id`, chunk + embed + upsert new content
5. If unchanged: skip (update `last_checked` date only)

### 8.6 Stale Chunk Detection

A chunk is stale if:
- Its `source_id` is no longer in the source manifest (URL removed)
- Its source URL returned 404 during re-scrape (per `edgeCase.md`)
- Its `last_checked` date is older than the configured staleness threshold

```typescript
async function removeStaleChunks(
  collection: ChromaCollection,
  activeSourceIds: Set<string>
): Promise<number> {
  const allChunks = await collection.get();
  const staleIds = allChunks.ids.filter((id, i) => {
    const sourceId = allChunks.metadatas[i].source_id;
    return !activeSourceIds.has(sourceId as string);
  });

  if (staleIds.length > 0) {
    await collection.delete({ ids: staleIds });
  }

  return staleIds.length;
}
```

Per `edgeCase.md`: "Source URL returns 404 during ingestion → log as failed, flag in source manifest, do not ingest partial content."

---

## 9. Cost Summary

| Component | Service | Cost |
|---|---|---|
| Embedding model | Gemini gemini-embedding-001 (free tier) | **$0** |
| Vector store | ChromaDB (local) | **$0** |
| Query classification | Gemini 2.5 Flash-Lite (free tier) | **$0** |
| Answer generation | Gemini 2.5 Flash (free tier) | **$0** |
| Safety check | Gemini 2.5 Flash-Lite (free tier) | **$0** |
| BM25 reranking | Local algorithm (no API) | **$0** |
| Web scraping | Playwright (local) | **$0** |
| **Total** | | **$0** |

No component in this architecture costs money. All services use free tiers or run locally.

---

## 10. LLM Model-per-Task Allocation (Resolves ADR-009 for Module C)

| Task | Model | Tier | Free Limit | Notes |
|---|---|---|---|---|
| Query classification | Gemini 2.5 Flash-Lite | Cheapest | 15 RPM, 1,000 RPD | ~50 tokens/call |
| Query embedding | Gemini gemini-embedding-001 | N/A (embedding) | Free tier via Gemini API / AI Studio | ~20 tokens/call |
| Answer generation | Gemini 2.5 Flash | Best free | 10 RPM, 500 RPD | ~500 tokens/call |
| Safety check | Gemini 2.5 Flash-Lite | Cheapest | 15 RPM, 1,000 RPD | ~100 tokens/call |

**Per FAQ query cost breakdown:** 2 Flash-Lite calls (classify + safety) + 1 Flash call (generate) + 1 embedding call = 4 API calls total. Classification and safety use Flash-Lite's 1,000 RPD budget. Generation uses Flash's 500 RPD budget. This supports hundreds of FAQ queries per day — far exceeding capstone demo needs.

**Fallback:** If Gemini 2.5 Flash-Lite rate limit (15 RPM) is hit, classification and safety check can fall back to Groq Llama 3 (30 RPM free). Answer generation stays on Gemini 2.5 Flash for quality.
