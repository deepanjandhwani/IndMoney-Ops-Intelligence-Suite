import { bm25Rerank } from "./bm25";
import { buildMetadataFilter } from "./classify";
import { GeminiRagClient } from "./gemini";
import { QueryClassification, RetrievalCandidate } from "./types";
import { VectorStore } from "./chroma";

const DEFAULT_VECTOR_RESULTS = 10;
const DEFAULT_CONTEXT_RESULTS = 5;
const MULTI_SOURCE_CONTEXT_RESULTS = 6;
const FEE_STATIC_SOURCE_ID = "fee_static_001";
const FEE_STATIC_TOP_CHUNKS = 2;
// Sufficiency rule per docs/architecture/ragA.md §5.4:
// top score must be >= 0.4 AND at least one chunk >= 0.5.
const MIN_TOP_RELEVANCE = 0.4;
const STRONG_RELEVANCE_FLOOR = 0.5;

export async function retrieveContext(input: {
  query: string;
  classification: QueryClassification;
  vectorStore: VectorStore;
  llm: Pick<GeminiRagClient, "embedQuery">;
  nResults?: number;
  topK?: number;
}): Promise<RetrievalCandidate[]> {
  if (input.classification.category === "out_of_scope") {
    return [];
  }

  const queryEmbedding = await input.llm.embedQuery(input.query);
  const primaryCandidates = await input.vectorStore.query({
    queryEmbedding,
    where: buildMetadataFilter(input.classification),
    nResults: input.nResults ?? DEFAULT_VECTOR_RESULTS
  });

  const topK = input.topK ?? DEFAULT_CONTEXT_RESULTS;
  let ranked = bm25Rerank(input.query, primaryCandidates, topK);

  if (input.classification.category === "multi_source") {
    ranked = await mergeFeeStaticChunksForMultiSource({
      query: input.query,
      queryEmbedding,
      vectorStore: input.vectorStore,
      ranked
    });
    const matchedFunds = input.classification.matched_scheme_names ?? [];
    if (matchedFunds.length > 3) {
      ranked = await ensureAllFundsRepresented({
        query: input.query,
        queryEmbedding,
        vectorStore: input.vectorStore,
        matchedFunds,
        ranked,
        topK
      });
    }
  }

  // Cross-domain second hop (per ragA.md §5.3): when primary retrieval is
  // insufficient, try the complementary content_type once. This covers
  // scheme_fact ↔ fee_explanation and is capped at exactly one extra call.
  if (
    !hasSufficientContext(ranked) &&
    (input.classification.category === "scheme_fact" ||
      input.classification.category === "fee_explanation")
  ) {
    ranked = await crossDomainSecondHop({
      query: input.query,
      queryEmbedding,
      classification: input.classification,
      vectorStore: input.vectorStore,
      ranked,
      topK
    });
  }

  if (
    input.classification.category === "scheme_fact" &&
    (input.classification.matched_scheme_names?.length ?? 0) > 3
  ) {
    ranked = await ensureAllFundsRepresented({
      query: input.query,
      queryEmbedding,
      vectorStore: input.vectorStore,
      matchedFunds: input.classification.matched_scheme_names!,
      ranked,
      topK
    });
  }

  return boostSchemeFactTopicMatches(ranked, input.classification);
}

async function crossDomainSecondHop(input: {
  query: string;
  queryEmbedding: number[];
  classification: QueryClassification;
  vectorStore: VectorStore;
  ranked: RetrievalCandidate[];
  topK: number;
}): Promise<RetrievalCandidate[]> {
  const secondaryFilter =
    input.classification.category === "scheme_fact"
      ? { content_type: "fee_explanation" }
      : { content_type: "scheme_fact" };
  const secondary = await input.vectorStore.query({
    queryEmbedding: input.queryEmbedding,
    where: secondaryFilter,
    nResults: 6
  });
  if (secondary.length === 0) {
    return input.ranked;
  }
  const seen = new Set(input.ranked.map((c) => c.id));
  const merged = [...input.ranked, ...secondary.filter((c) => !seen.has(c.id))];
  return bm25Rerank(input.query, merged, Math.max(input.topK, MULTI_SOURCE_CONTEXT_RESULTS));
}

async function mergeFeeStaticChunksForMultiSource(input: {
  query: string;
  queryEmbedding: number[];
  vectorStore: VectorStore;
  ranked: RetrievalCandidate[];
}): Promise<RetrievalCandidate[]> {
  const feeRaw = await input.vectorStore.query({
    queryEmbedding: input.queryEmbedding,
    where: { source_id: FEE_STATIC_SOURCE_ID },
    nResults: 8
  });

  if (feeRaw.length === 0) {
    return input.ranked;
  }

  const feePicks = [...feeRaw]
    .sort((a, b) => b.cosineScore - a.cosineScore)
    .slice(0, FEE_STATIC_TOP_CHUNKS)
    .map((c) => ({
      ...c,
      bm25Score: 0,
      relevanceScore: Math.max(c.relevanceScore, c.cosineScore)
    }));

  const seen = new Set(feePicks.map((c) => c.id));
  const rest = input.ranked.filter((c) => !seen.has(c.id));
  const merged = [...feePicks, ...rest];

  const reranked = bm25Rerank(input.query, merged, MULTI_SOURCE_CONTEXT_RESULTS);

  // Guarantee at least one fee_static chunk survives reranking so the
  // fee explainer citation always appears for multi_source answers.
  const hasFeeChunk = reranked.some((c) => c.metadata.source_id === FEE_STATIC_SOURCE_ID);
  if (!hasFeeChunk && feePicks.length > 0) {
    reranked.push(feePicks[0]);
  }

  return reranked;
}

async function ensureAllFundsRepresented(input: {
  query: string;
  queryEmbedding: number[];
  vectorStore: VectorStore;
  matchedFunds: string[];
  ranked: RetrievalCandidate[];
  topK: number;
}): Promise<RetrievalCandidate[]> {
  const representedFunds = new Set(
    input.ranked
      .filter((c) => c.metadata.scheme_name)
      .map((c) => c.metadata.scheme_name as string)
  );
  const missingFunds = input.matchedFunds.filter((f) => !representedFunds.has(f));
  if (missingFunds.length === 0) {
    return input.ranked;
  }

  const backfill = await input.vectorStore.query({
    queryEmbedding: input.queryEmbedding,
    where: {
      $and: [
        { content_type: "scheme_fact" },
        { $or: missingFunds.map((name) => ({ scheme_name: name })) }
      ]
    },
    nResults: missingFunds.length * 2
  });

  if (backfill.length === 0) {
    return input.ranked;
  }

  const seen = new Set(input.ranked.map((c) => c.id));
  const newChunks = backfill.filter((c) => !seen.has(c.id));
  const merged = [...input.ranked, ...newChunks];
  return bm25Rerank(input.query, merged, Math.max(input.topK, input.matchedFunds.length + 2));
}

export function hasSufficientContext(candidates: RetrievalCandidate[]) {
  if (candidates.length === 0) {
    return false;
  }

  // Per docs/architecture/ragA.md §5.4: require a top relevance >= 0.4 AND at
  // least one chunk >= 0.5 to avoid scraping marginal matches into an answer.
  const topScore = candidates.reduce(
    (max, candidate) => Math.max(max, candidate.relevanceScore),
    0
  );
  if (topScore < MIN_TOP_RELEVANCE) {
    return false;
  }
  return candidates.some((candidate) => candidate.relevanceScore >= STRONG_RELEVANCE_FLOOR);
}

function boostSchemeFactTopicMatches(
  candidates: RetrievalCandidate[],
  classification: QueryClassification
) {
  if (classification.category !== "scheme_fact" || !classification.extracted_topic) {
    return candidates;
  }

  const topicTerms = topicTermsFor(classification.extracted_topic);
  if (topicTerms.length === 0) {
    return candidates;
  }

  return candidates
    .map((candidate) => {
      const lowerText = candidate.text.toLowerCase();
      const hasTopicText = topicTerms.some((term) => lowerText.includes(term));
      const hasTopicMetadata = candidate.metadata.section_type === classification.extracted_topic;
      if (!hasTopicText && !hasTopicMetadata) {
        return candidate;
      }

      return {
        ...candidate,
        relevanceScore: Math.max(candidate.relevanceScore + 0.15, MIN_TOP_RELEVANCE)
      };
    })
    .sort((left, right) => right.relevanceScore - left.relevanceScore);
}

function topicTermsFor(topic: string) {
  switch (topic) {
    case "nav":
      return ["nav", "net asset value"];
    case "aum":
      return ["aum", "asset under management"];
    case "holdings":
      return ["holding", "holdings", "allocation"];
    case "returns":
      return ["return", "returns", "annualised", "absolute", "sip return"];
    case "fund_manager":
      return ["fund manager", "managed by", "manager"];
    case "rating":
      return ["rating", "rated", "stars", "star"];
    case "fund_overview":
      return ["fund overview", "category", "equity", "debt", "hybrid"];
    case "benchmark":
      return ["benchmark"];
    case "min_sip":
      return ["minimum sip", "minimum investment", "min sip"];
    case "expense_ratio":
      return ["expense ratio"];
    case "exit_load":
      return ["exit load"];
    default:
      return [];
  }
}
