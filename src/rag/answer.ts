import { citationsFromCandidates, hasRequiredCitations } from "./citations";
import { GeminiRagClient } from "./gemini";
import { answerHasSafetyIssue, NO_RESULTS_MESSAGE, SAFETY_REFUSAL } from "./safety";
import { ConversationTurn, FaqAnswer, RetrievalCandidate } from "./types";

export async function generateCitedAnswer(input: {
  query: string;
  candidates: RetrievalCandidate[];
  llm: Pick<GeminiRagClient, "generateAnswer" | "safetyJson">;
  piiMasked?: boolean;
  history?: ConversationTurn[];
}): Promise<FaqAnswer> {
  const citations = citationsFromCandidates(input.candidates);
  if (citations.length === 0) {
    return noResults(input.piiMasked);
  }

  const rawAnswer = await input.llm.generateAnswer(answerPrompt(input.query, input.candidates, input.history));
  const safetyPassed = await answerPassesSafety(rawAnswer, input.query, citations, input.llm);

  if (!safetyPassed) {
    return {
      status: "refused",
      answer: SAFETY_REFUSAL,
      citations: [],
      pii_masked: input.piiMasked
    };
  }

  if (!hasRequiredCitations(rawAnswer, citations, input.candidates)) {
    if (process.env.RAG_DEBUG === "true" || process.env.RAG_DEBUG === "1") {
      console.warn(
        `[answer-debug] hasRequiredCitations=false rawLen=${rawAnswer.length} preview="${rawAnswer.slice(0, 200).replace(/\n/g, " ")}"`
      );
    }
    return {
      status: "no_results",
      answer: NO_RESULTS_MESSAGE,
      citations: [],
      health_error: "Generated answer missing required citation metadata.",
      pii_masked: input.piiMasked
    };
  }

  const answer = sanitizeAnswerForDisplay(rawAnswer);

  return {
    status: "answered",
    answer,
    citations,
    pii_masked: input.piiMasked
  };
}

/**
 * Remove inline citation parentheticals and duplicate date trailers — the UI
 * already shows source cards with source_id and last_checked.
 */
function sanitizeAnswerForDisplay(answer: string): string {
  let s = answer
    // Parenthetical or bracketed blocks containing source_id / fee_static
    .replace(/\s*[(\[][^)\]]*source_id\s*:?\s*[^;)\]]+[;)\]][^)\]]*(?:Last\s+checked\s*:?\s*[^)\]]+)?[)\]]/gi, " ")
    .replace(/\s*[(\[][^)\]]*fee_static_001[^)\]]*[)\]]/gi, " ")
    // "Source: …" inline labels
    .replace(/\s*Source\s*:\s*[^\n.]+(?:\.\s*Last\s+checked\s*:\s*[\d-]+)?\.?/gi, " ")
    // Trailing "Last updated from sources" (shown in citation cards instead)
    .replace(/\n+\s*Last\s+updated\s+from\s+sources\s*:?\s*[\d-]+\s*$/gim, "")
    .replace(/\n+\s*Last\s+updated\s+from\s+sources\s*:?\s*[\d-]+\s*\n/gim, "\n");

  s = s.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return s;
}

export function noResults(piiMasked?: boolean, healthError?: string): FaqAnswer {
  return {
    status: "no_results",
    answer: NO_RESULTS_MESSAGE,
    citations: [],
    health_error: healthError,
    pii_masked: piiMasked
  };
}

function answerPrompt(query: string, candidates: RetrievalCandidate[], history?: ConversationTurn[]) {
  const context = candidates
    .map((candidate, index) => {
      const citation = citationLabel(candidate);
      return `Chunk ${index + 1}
Citation: ${citation}
Content:
${candidate.text}`;
    })
    .join("\n\n---\n\n");

  const historySection =
    history && history.length > 0
      ? `Conversation so far (for context only — do not repeat or summarize it):
${history
  .slice(-3)
  .map((turn) => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.text.slice(0, 300)}`)
  .join("\n")}

`
      : "";

  const distinctFunds = new Set(
    candidates
      .filter((c) => c.metadata.scheme_name)
      .map((c) => c.metadata.scheme_name as string)
  );
  const fundNames = [...distinctFunds].map(f => f.replace(/\s+Direct\s+(Plan\s+)?Growth(\s+Option)?$/i, ""));
  let multiFundHint = "";
  if (distinctFunds.size >= 4) {
    multiFundHint =
      `- The chunks below cover ${distinctFunds.size} different funds (${fundNames.join(", ")}). ` +
      `When the question asks for a SINGLE attribute (e.g. NAV, expense ratio, exit load, benchmark, rating) across these funds, present the answer as a **markdown table** with columns "Fund" and the requested value(s), plus an "as of" date column if applicable. ` +
      `This is much more readable than ${distinctFunds.size} separate bullets. ` +
      `Do NOT refuse just because the user's wording doesn't exactly match a fund name — the retrieval system already matched these as the closest funds.\n`;
  } else if (distinctFunds.size > 1) {
    multiFundHint =
      `- The chunks below cover ${distinctFunds.size} different funds (${fundNames.join(", ")}). Present facts for EACH matched fund using a bullet per fund. Do NOT refuse just because the user's wording doesn't exactly match a fund name — the retrieval system already matched these as the closest funds.\n`;
  }

  return `You are the Smart-Sync FAQ assistant for Groww.

Rules:
- Answer ONLY what was asked. Do not volunteer extra attributes.
- Use only the approved source chunks below. If chunks lack the answer, say so.
- Values (NAV, AUM, etc.) are source-backed as of chunk dates — not live.
- No investment advice, buy/sell/hold, future predictions, or account handling. Historic/SIP returns from chunks are allowed (factual data).
- When fund name is approximate, answer from the matched chunks and use the exact fund name from the chunk.
- Concise: max 6 bullets for ≤3 funds. For 4+ funds on the same attribute, use a markdown table.
- No inline citations like "(source_id: …)" — UI shows sources separately. No "Last updated from sources" line.
- Fee questions asking "What is [term]?" — start with a brief definition before fund-specific values.
- Same source_id = one source. Don't say "confirmed by another source" for same-page chunks.
- Same value appearing in multiple chunks → report once. Conflicting values → pick the most specific context, report only that.
- Use exact fund names from chunks. Do not invent or modify names.
${multiFundHint}
${historySection}Customer question: ${query}

Approved source chunks:
${context}`;
}

function citationLabel(candidate: RetrievalCandidate) {
  const metadata = candidate.metadata;
  const source = metadata.url ?? metadata.source_id;
  return `${source} (${metadata.title}; source_id: ${metadata.source_id}; Last checked: ${metadata.last_checked})`;
}

const LOW_RISK_ANSWER_MAX_LENGTH = 600;

function isLowRiskAnswer(answer: string, citations: ReturnType<typeof citationsFromCandidates>) {
  if (answer.length > LOW_RISK_ANSWER_MAX_LENGTH) return false;
  const allApprovedSources = citations.every(
    (c) => c.content_type === "scheme_fact" || c.content_type === "fee_explanation"
  );
  return allApprovedSources;
}

async function answerPassesSafety(
  answer: string,
  userQuery: string,
  citations: ReturnType<typeof citationsFromCandidates>,
  llm: Pick<GeminiRagClient, "safetyJson">
) {
  if (answerHasSafetyIssue(answer)) {
    return false;
  }

  // For short factual answers from approved sources, the regex check above
  // is sufficient — skip the LLM safety call to save tokens.
  if (isLowRiskAnswer(answer, citations)) {
    return true;
  }

  const payload = JSON.stringify({
    user_query: userQuery,
    answer,
    citations: citations.map((c) => ({
      source_id: c.source_id,
      source_url: c.source_url,
      content_type: c.content_type,
      last_checked: c.last_checked
    }))
  });

  const prompt = `You are the safety check for the Smart-Sync FAQ.
Return JSON: {"passed": <bool>, "failed_checks": [<string>...]}.

Context: This system reports pre-indexed factual data (NAV, AUM, expense ratio, exit load, benchmark, riskometer, historic returns, fund manager, rating) from approved fund pages and fee explainer docs. These are sourced facts, NOT real-time lookups or predictions. The "last_checked" date is when we last verified the page — fund data on the page may be newer than that date (normal scraping behavior).

Set passed=true UNLESS the answer contains:
- Buy/sell/hold investment advice
- Forward-looking return predictions or guarantees
- PII (PAN, Aadhaar, phone, email, account number)
- Claims not grounded in the supplied citations
- Fee claims inconsistent with fee_static_001 (when present)

ALLOWED: NAV, AUM, expense ratios, exit loads, lock-in, benchmarks, riskometer, fund manager names, historic/SIP returns, fund category — all are sourced facts.

Payload:
${payload}`;

  try {
    const result = await llm.safetyJson(prompt);
    if (result.passed !== true) {
      console.warn("[safety-check] LLM rejected answer:", JSON.stringify(result));
    }
    return result.passed === true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/quota|429|Too Many Requests|RESOURCE_EXHAUSTED/i.test(msg)) {
      console.warn("[safety-check] LLM quota exhausted — falling back to regex check:", msg);
      return true;
    }
    console.error("[safety-check] LLM error (fail-closed):", msg);
    return false;
  }
}
