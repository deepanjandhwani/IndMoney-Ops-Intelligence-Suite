import { maskPii } from "../services/safety/pii";
import { generateCitedAnswer, noResults } from "./answer";
import { classifyQuery } from "./classify";
import { isChromaUnavailable, VectorStore } from "./chroma";
import { detectMentionedFunds, getApprovedSchemeNames } from "./fund-resolver";
import { GeminiRagClient } from "./gemini";
import { retrieveContext, hasSufficientContext } from "./retrieve";
import { GREETING_RESPONSE, SAFETY_REFUSAL, shouldRefuseQuery } from "./safety";
import { ConversationTurn, FaqAnswer, QueryClassification } from "./types";

export function isGeminiServiceError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /503|429|Too Many Requests|RESOURCE_EXHAUSTED|Service Unavailable|high demand|rate limit|fetch failed|ECONNRESET|ETIMEDOUT/i.test(message);
}

function fundMismatchFromCanonicals(
  fundCanonicalNames: string[],
  piiMasked: boolean,
): FaqAnswer {
  const fundList =
    fundCanonicalNames.length === 1
      ? `"${fundCanonicalNames[0]}"`
      : fundCanonicalNames.map((f) => `"${f}"`).join(", ");
  return {
    status: "fund_mismatch",
    answer: `Your question mentions ${fundList}, but ${fundCanonicalNames.length === 1 ? "it's" : "they're"} not in your current fund selection. Please add ${fundCanonicalNames.length === 1 ? "it" : "them"} to the fund filter below to get results.`,
    citations: [],
    pii_masked: piiMasked,
    suggested_funds: fundCanonicalNames,
  };
}

function geminiDegradedFaqAnswer(piiMasked: boolean, errorMessage: string): FaqAnswer {
  const quota = /429|quota|RESOURCE_EXHAUSTED|rate limit|Too Many Requests/i.test(errorMessage);
  const answer = quota
    ? "The AI service hit a rate limit or daily quota (common on the free Gemini tier). Your question is fine — indexing may be OK, but the model could not finish this step. Wait a minute and retry, raise quota/billing on Google AI, or add GROQ_API_KEY so classification can avoid some Gemini calls."
    : "The AI model had a temporary error or overload. Please try again in a moment.";
  return {
    status: "no_results",
    answer,
    citations: [],
    health_error: errorMessage,
    pii_masked: piiMasked
  };
}

export type SmartSyncFaqService = {
  answerQuestion(
    query: string,
    selectedFunds: string[],
    history?: ConversationTurn[]
  ): Promise<FaqAnswer>;
};

export function createSmartSyncFaqService(input: {
  vectorStore: VectorStore;
  llm: GeminiRagClient;
}): SmartSyncFaqService {
  return {
    async answerQuestion(query, selectedFunds, history) {
      if (shouldRefuseQuery(query)) {
        return {
          status: "refused",
          answer: SAFETY_REFUSAL,
          citations: []
        };
      }

      const masked = maskPii(query);
      const piiMasked = masked.findings.length > 0;
      let safeQuery = masked.maskedText;

      if (history && history.length > 0 && needsRewrite(safeQuery)) {
        safeQuery = await rewriteWithHistory(safeQuery, history, input.llm);
      }

      // Fast path: explicit fund name or alias in the query but not in the filter
      // avoids waiting on LLM classification for the common "add fund" response.
      const selectionSetEarly = new Set(selectedFunds);
      const strictDetected = detectMentionedFunds(safeQuery, selectedFunds, { fuzzy: false });
      const strictNotInSelection = strictDetected.funds.filter(
        (f) => !selectionSetEarly.has(f.canonical),
      );
      if (strictNotInSelection.length > 0) {
        return fundMismatchFromCanonicals(
          strictNotInSelection.map((f) => f.canonical),
          piiMasked,
        );
      }

      const classification = await classifyQuery(safeQuery, input.llm);

      if (process.env.RAG_DEBUG === "true" || process.env.RAG_DEBUG === "1") {
        console.log(
          `[faq-debug] q="${safeQuery.slice(0, 80)}" → category=${classification.category} fund=${classification.extracted_scheme_name ?? "-"} topic=${classification.extracted_topic ?? "-"}`
        );
      }

      if (classification.category === "greeting") {
        return {
          status: "answered",
          answer: GREETING_RESPONSE,
          citations: []
        };
      }

      if (classification.category === "out_of_scope") {
        return {
          status: "refused",
          answer: SAFETY_REFUSAL,
          citations: [],
          pii_masked: piiMasked
        };
      }

      const isFundCategory =
        classification.category === "scheme_fact" ||
        classification.category === "multi_source";

      // Fund detection: trust the LLM's extracted_scheme_name first, then fall
      // back to the alias-based detectMentionedFunds() for typo tolerance
      // (e.g. "Farma" → "pharma" alias → HDFC Pharma and Healthcare Fund).
      const llmFund = classification.extracted_scheme_name;
      const approvedSet = new Set(getApprovedSchemeNames());
      let mentionedFund: string | null = (llmFund && approvedSet.has(llmFund)) ? llmFund : null;

      // When the LLM couldn't resolve a fund, use alias-based detection as a
      // fallback. This catches typos like "Farma" → pharma and "midca" → midcap.
      // Also narrows scope to only the detected funds so unrelated funds in the
      // user's selection don't leak into retrieval results.
      let detectedInSelection: string[] = [];
      if (!mentionedFund) {
        const detected = detectMentionedFunds(safeQuery, selectedFunds);
        const selectionSet = new Set(selectedFunds);
        const notInSelection = detected.funds.filter((f) => !selectionSet.has(f.canonical));
        const inSelection = detected.funds.filter((f) => selectionSet.has(f.canonical));

        if (notInSelection.length > 0) {
          return fundMismatchFromCanonicals(
            notInSelection.map((f) => f.canonical),
            piiMasked,
          );
        }

        if (inSelection.length > 0) {
          detectedInSelection = inSelection.map((f) => f.canonical);
        }
      }

      // If LLM matched a fund that's not in the user's selection → mismatch
      if (mentionedFund) {
        const selectionSet = new Set(selectedFunds);
        if (!selectionSet.has(mentionedFund)) {
          return {
            status: "fund_mismatch",
            answer: `Your question mentions "${mentionedFund}", but it's not in your current fund selection. Please add it to the fund filter below to get results.`,
            citations: [],
            pii_masked: piiMasked,
            suggested_funds: [mentionedFund]
          };
        }
      }

      // Fund-specific question with no fund detected and nothing selected
      if (isFundCategory && !mentionedFund && (!selectedFunds || selectedFunds.length === 0)) {
        return {
          status: "refused",
          answer: "Please select at least one fund from the filter bar below before asking a question.",
          citations: [],
          pii_masked: piiMasked
        };
      }

      const scopedFunds = mentionedFund
        ? [mentionedFund]
        : detectedInSelection.length > 0
          ? detectedInSelection
          : selectedFunds;
      const effectiveClassification = applySelectedFunds(classification, scopedFunds, safeQuery);

      const debug = process.env.RAG_DEBUG === "true" || process.env.RAG_DEBUG === "1";

      try {
        const t0 = Date.now();
        const candidates = await retrieveContext({
          query: safeQuery,
          classification: effectiveClassification,
          vectorStore: input.vectorStore,
          llm: input.llm,
          ...retrievalOptionsFor(effectiveClassification)
        });
        const t1 = Date.now();

        if (debug) {
          const top = candidates.slice(0, 5).map((c) =>
            `${c.metadata.source_id}/${c.metadata.scheme_name?.slice(0, 25) ?? "-"}@${c.relevanceScore.toFixed(3)}`
          );
          console.log(`[faq-perf] retrieve=${t1 - t0}ms chunks=${candidates.length} top=[${top.join(", ")}]`);
        }

        if (!hasSufficientContext(candidates)) {
          return noResults(piiMasked);
        }

        const answer = await generateCitedAnswer({
          query: safeQuery,
          candidates,
          llm: input.llm,
          piiMasked,
          history
        });
        const t2 = Date.now();
        if (debug) {
          console.log(`[faq-perf] generate+safety=${t2 - t1}ms total=${t2 - t0}ms status=${answer.status}`);
        }

        const resolvedFund = effectiveClassification.extracted_scheme_name ?? null;
        return {
          ...answer,
          resolved_fund: resolvedFund
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        console.error("[faq] retrieval/answer error:", errorMessage);
        if (isChromaUnavailable(error)) {
          console.error("[faq] classified as Chroma unavailable");
          return noResults(piiMasked, errorMessage);
        }
        if (isGeminiServiceError(error)) {
          console.error("[faq] classified as Gemini service error");
          return geminiDegradedFaqAnswer(piiMasked, errorMessage);
        }
        throw error;
      }
    }
  };
}

const FUND_OR_TOPIC_PATTERN =
  /\b(nav|aum|holdings?|returns?|expense ratio|exit load|lock-?in|benchmark|riskometer|fund manager|rating|sip|elss|fee|fees)\b/i;

const EXPLICIT_FUND_PATTERN =
  /\b(hdfc|nifty|midcap|mid-cap|smallcap|small-cap|defence|pharma|transportation|banking|infrastructure|value)\b/i;

function needsRewrite(query: string): boolean {
  const words = query.trim().split(/\s+/);
  if (words.length > 10) return false;
  if (EXPLICIT_FUND_PATTERN.test(query)) return false;
  if (!FUND_OR_TOPIC_PATTERN.test(query)) return true;
  if (words.length <= 4) return true;
  return false;
}

async function rewriteWithHistory(
  query: string,
  history: ConversationTurn[],
  llm: Pick<GeminiRagClient, "rewriteQuery">
): Promise<string> {
  const contextLines = history
    .slice(-4)
    .map((turn) => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.text.slice(0, 200)}`)
    .join("\n");

  const prompt = `You are rewriting a user follow-up question so it is self-contained.

Conversation so far:
${contextLines}

Latest user message: "${query}"

Rewrite the latest user message into a single, self-contained question that includes any fund name or topic referenced in the conversation. Keep it short (under 20 words). If the message is already self-contained, return it as-is. Return ONLY the rewritten question text, nothing else.`;

  try {
    const rewritten = await llm.rewriteQuery(prompt);
    const cleaned = rewritten.replace(/^["']|["']$/g, "").trim();
    if (cleaned.length > 0 && cleaned.length < 200) {
      if (process.env.RAG_DEBUG === "true" || process.env.RAG_DEBUG === "1") {
        console.log(`[faq-rewrite] "${query}" → "${cleaned}"`);
      }
      return cleaned;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[faq-rewrite] failed, using original query:", msg);
  }
  return query;
}

function retrievalOptionsFor(classification: QueryClassification) {
  const topic = classification.extracted_topic;
  const isSchemeFact = classification.category === "scheme_fact";
  const isMultiSource = classification.category === "multi_source";
  const isExpandedFact =
    topic === "nav" ||
    topic === "aum" ||
    topic === "holdings" ||
    topic === "returns" ||
    topic === "expense_ratio" ||
    topic === "exit_load" ||
    topic === "benchmark" ||
    topic === "fund_manager" ||
    topic === "rating" ||
    topic === "fund_overview" ||
    topic === "min_sip";

  if (isMultiSource) {
    const matchedCount = classification.matched_scheme_names?.length ?? 0;
    if (matchedCount > 3) {
      return {
        nResults: Math.max(16, matchedCount * 3),
        topK: Math.max(8, matchedCount * 2)
      };
    }
    return { nResults: 16, topK: 8 };
  }

  if (!isSchemeFact || !isExpandedFact) {
    return {};
  }

  if (classification.query_scope === "multi_fund" || classification.query_scope === "all_funds") {
    const matchedCount = classification.matched_scheme_names?.length ?? 0;
    return {
      nResults: Math.max(40, matchedCount * 3),
      topK: Math.max(20, matchedCount * 2)
    };
  }

  return {
    nResults: 16,
    topK: 8
  };
}

const CONCEPTUAL_FEE_PATTERN =
  /\b(why|what does|what is|meaning|mean|explain|definition|how does|how is|what are)\b/i;

/**
 * Scope a classification to only the funds the user explicitly selected via
 * the filter bar. Overrides matched_scheme_names and query_scope so that
 * buildMetadataFilter restricts ChromaDB to those funds only.
 *
 * Fee explanations, process help, and multi-source questions live in
 * fund-agnostic chunks so we do NOT apply fund filtering for those.
 */
function applySelectedFunds(
  classification: QueryClassification,
  selectedFunds: string[],
  query?: string
): QueryClassification {
  if (selectedFunds.length === 0) {
    return classification;
  }

  if (classification.category === "process_help") {
    return classification;
  }

  if (classification.category === "regulatory_education") {
    const topic = classification.extracted_topic;
    const fundSpecificTopics = ["returns", "fund_manager", "rating", "fund_overview", "nav", "aum", "benchmark", "min_sip", "expense_ratio", "exit_load", "holdings"];
    if (topic && fundSpecificTopics.includes(topic)) {
      if (selectedFunds.length === 1) {
        return {
          ...classification,
          category: "scheme_fact",
          extracted_scheme_name: selectedFunds[0],
          matched_scheme_names: selectedFunds,
          query_scope: "single_fund"
        };
      }
      return {
        ...classification,
        category: "scheme_fact",
        extracted_scheme_name: null,
        matched_scheme_names: selectedFunds,
        query_scope: "multi_fund"
      };
    }
    return classification;
  }

  if (classification.category === "fee_explanation") {
    const topic = classification.extracted_topic ?? classification.extracted_fee_type;
    const isFundAttribute = topic === "expense_ratio" || topic === "exit_load";
    if (!isFundAttribute) {
      return classification;
    }
    // If the query is conceptual ("why is exit load charged?", "what does expense
    // ratio mean?") keep it as fee_explanation — don't pull fund-specific values.
    const isConceptual = query ? CONCEPTUAL_FEE_PATTERN.test(query) && !EXPLICIT_FUND_PATTERN.test(query) : false;
    if (isConceptual) {
      return classification;
    }
    // "What is the expense ratio of this fund?" or fund-specific fee queries
    // with funds selected → promote to multi_source so retrieval gets both the
    // fund-specific value AND the fee explainer content.
    if (selectedFunds.length === 1) {
      return {
        ...classification,
        category: "multi_source",
        extracted_scheme_name: selectedFunds[0],
        matched_scheme_names: selectedFunds,
        query_scope: "single_fund"
      };
    }
    return {
      ...classification,
      category: "multi_source",
      extracted_scheme_name: null,
      matched_scheme_names: selectedFunds,
      query_scope: "multi_fund"
    };
  }

  if (classification.category === "multi_source") {
    if (selectedFunds.length === 0) {
      return classification;
    }
    if (selectedFunds.length === 1) {
      return {
        ...classification,
        extracted_scheme_name: selectedFunds[0],
        matched_scheme_names: selectedFunds,
        query_scope: "single_fund"
      };
    }
    return {
      ...classification,
      extracted_scheme_name: null,
      matched_scheme_names: selectedFunds,
      query_scope: "multi_fund"
    };
  }

  if (selectedFunds.length === 1) {
    return {
      ...classification,
      category: "scheme_fact",
      extracted_scheme_name: selectedFunds[0],
      matched_scheme_names: selectedFunds,
      query_scope: "single_fund"
    };
  }
  return {
    ...classification,
    category: "scheme_fact",
    extracted_scheme_name: null,
    matched_scheme_names: selectedFunds,
    query_scope: "multi_fund"
  };
}
