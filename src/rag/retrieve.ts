import { Where } from "chromadb";

import { bm25Rerank } from "./bm25";
import { buildMetadataFilter } from "./classify";
import { GeminiRagClient } from "./gemini";
import { QueryClassification, RetrievalCandidate } from "./types";
import { VectorStore } from "./chroma";

const DEFAULT_VECTOR_RESULTS = 10;
const DEFAULT_CONTEXT_RESULTS = 5;
const MULTI_SOURCE_CONTEXT_RESULTS = 6;
/** When the user asks for both ER and exit load, keep a wider rerank budget so overview + exit-load chunks survive. */
const MULTI_SOURCE_CONTEXT_RESULTS_DUAL = 10;
const FEE_STATIC_SOURCE_ID = "fee_static_001";
const FEE_STATIC_TOP_CHUNKS = 2;
// Sufficiency rule per docs/architecture/ragA.md §5.4:
// top score must be >= 0.4 AND at least one chunk >= 0.5.
const MIN_TOP_RELEVANCE = 0.4;
const STRONG_RELEVANCE_FLOOR = 0.5;

export function dualSchemeFeeTopicsInQuery(query: string): boolean {
  const lower = query.toLowerCase();
  return lower.includes("expense ratio") && lower.includes("exit load");
}

function multiSourceFeePinTopics(
  query: string,
  classification: QueryClassification
): Array<"expense_ratio" | "exit_load"> {
  if (classification.category !== "multi_source") {
    return [];
  }
  const lower = query.toLowerCase();
  const hasExpenseRatioAsk = lower.includes("expense ratio");
  const hasExitLoadAsk = lower.includes("exit load");
  if (hasExpenseRatioAsk && hasExitLoadAsk) {
    return ["expense_ratio", "exit_load"];
  }

  const fromTopic =
    classification.extracted_topic === "expense_ratio" || classification.extracted_topic === "exit_load"
      ? classification.extracted_topic
      : null;
  const fromFeeType =
    classification.extracted_fee_type === "expense_ratio" || classification.extracted_fee_type === "exit_load"
      ? classification.extracted_fee_type
      : null;

  const single = (fromTopic ?? fromFeeType) as "expense_ratio" | "exit_load" | null;
  return single ? [single] : [];
}

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
    const candidateCap = dualSchemeFeeTopicsInQuery(input.query)
      ? MULTI_SOURCE_CONTEXT_RESULTS_DUAL
      : MULTI_SOURCE_CONTEXT_RESULTS;
    ranked = await mergeFeeStaticChunksForMultiSource({
      query: input.query,
      queryEmbedding,
      vectorStore: input.vectorStore,
      ranked,
      candidateCap
    });
    ranked = await pinMultiSourceFeeValueChunks({
      query: input.query,
      queryEmbedding,
      classification: input.classification,
      vectorStore: input.vectorStore,
      ranked,
      topK,
      candidateCap
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
  candidateCap?: number;
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

  const cap = input.candidateCap ?? MULTI_SOURCE_CONTEXT_RESULTS;
  const reranked = bm25Rerank(input.query, merged, cap);

  // Guarantee at least one fee_static chunk survives reranking so the
  // fee explainer citation always appears for multi_source answers.
  const hasFeeChunk = reranked.some((c) => c.metadata.source_id === FEE_STATIC_SOURCE_ID);
  if (!hasFeeChunk && feePicks.length > 0) {
    reranked.push(feePicks[0]);
  }

  return reranked;
}

async function pinMultiSourceFeeValueChunks(input: {
  query: string;
  queryEmbedding: number[];
  classification: QueryClassification;
  vectorStore: VectorStore;
  ranked: RetrievalCandidate[];
  topK: number;
  candidateCap: number;
}): Promise<RetrievalCandidate[]> {
  const feeTopics = multiSourceFeePinTopics(input.query, input.classification);
  if (feeTopics.length === 0) {
    return input.ranked;
  }

  const matchedFunds = input.classification.extracted_scheme_name
    ? [input.classification.extracted_scheme_name]
    : input.classification.matched_scheme_names ?? [];
  if (matchedFunds.length === 0) {
    return input.ranked;
  }

  const pinnedById = new Map<string, RetrievalCandidate>();

  for (const feeTopic of feeTopics) {
    let topicPinned = bestFeeValueChunkPerFund(input.ranked, matchedFunds, feeTopic);
    const pinnedFunds = new Set(
      topicPinned
        .map((candidate) => candidate.metadata.scheme_name)
        .filter((schemeName): schemeName is string => Boolean(schemeName))
    );
    const missingFunds = matchedFunds.filter((fund) => !pinnedFunds.has(fund));

    if (missingFunds.length > 0) {
      const backfill = await input.vectorStore.query({
        queryEmbedding: input.queryEmbedding,
        where: feeValueBackfillFilter(missingFunds, feeTopic),
        nResults: Math.max(4, missingFunds.length * 2)
      });
      topicPinned = topicPinned.concat(bestFeeValueChunkPerFund(backfill, missingFunds, feeTopic));
    }

    for (const candidate of topicPinned) {
      if (!pinnedById.has(candidate.id)) {
        pinnedById.set(candidate.id, candidate);
      }
    }
  }

  const pinned = [...pinnedById.values()];
  if (pinned.length === 0) {
    return input.ranked;
  }

  const boostedPinned = pinned.map((candidate) => ({
    ...candidate,
    relevanceScore: Math.max(candidate.relevanceScore + 0.2, STRONG_RELEVANCE_FLOOR)
  }));
  const pinnedIds = new Set(boostedPinned.map((candidate) => candidate.id));
  const merged = [
    ...boostedPinned,
    ...input.ranked.filter((candidate) => !pinnedIds.has(candidate.id))
  ];

  return merged.slice(0, Math.max(input.topK, input.candidateCap));
}

function bestFeeValueChunkPerFund(
  candidates: RetrievalCandidate[],
  matchedFunds: string[],
  feeTopic: string
): RetrievalCandidate[] {
  return matchedFunds
    .map((fund) => {
      const matches = candidates
        .filter((candidate) => candidateMatchesFeeValue(candidate, fund, feeTopic))
        .sort((left, right) => feeValueScore(right, feeTopic) - feeValueScore(left, feeTopic));
      return matches[0];
    })
    .filter((candidate): candidate is RetrievalCandidate => Boolean(candidate));
}

function candidateMatchesFeeValue(
  candidate: RetrievalCandidate,
  fund: string,
  feeTopic: string
) {
  if (candidate.metadata.content_type !== "scheme_fact") return false;
  if (candidate.metadata.scheme_name !== fund) return false;
  return candidateContainsFeeTopic(candidate, feeTopic);
}

function candidateContainsFeeTopic(candidate: RetrievalCandidate, feeTopic: string) {
  const terms = topicTermsFor(feeTopic);
  const lowerText = candidate.text.toLowerCase();
  return (
    candidate.metadata.section_type === feeTopic ||
    candidate.metadata.section_type === "fund_overview" ||
    terms.some((term) => lowerText.includes(term))
  );
}

function feeValueScore(candidate: RetrievalCandidate, feeTopic: string) {
  let score = candidate.relevanceScore;
  if (candidate.metadata.section_type === feeTopic) score += 0.3;
  if (candidate.metadata.section_type === "fund_overview") score += 0.15;
  if (topicTermsFor(feeTopic).some((term) => candidate.text.toLowerCase().includes(term))) {
    score += 0.1;
  }
  return score;
}

function feeValueBackfillFilter(matchedFunds: string[], feeTopic: string): Where {
  const schemeFilter: Where =
    matchedFunds.length === 1
      ? { scheme_name: matchedFunds[0] }
      : { $or: matchedFunds.map((name) => ({ scheme_name: name })) };
  const sectionFilter: Where =
    feeTopic === "expense_ratio"
      ? { $or: [{ section_type: "expense_ratio" }, { section_type: "fund_overview" }] }
      : { section_type: feeTopic };

  return {
    $and: [
      { content_type: "scheme_fact" },
      schemeFilter,
      sectionFilter
    ]
  };
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
