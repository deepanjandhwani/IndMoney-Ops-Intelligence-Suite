/**
 * 10 eval questions covering the breadth of all simplified RAG scenarios.
 *
 * Each test exercises a distinct code path through the pipeline:
 *   classify → mismatch guard → applySelectedFunds → retrieve → answer
 *
 * The tests use fake LLM/vector-store fixtures so they run offline
 * and deterministically, but the questions mirror real user phrasings.
 */
import { describe, expect, it } from "vitest";

import { createSmartSyncFaqService, SmartSyncFaqService } from "../src/rag/faq";
import { GeminiRagClient } from "../src/rag/gemini";
import { VectorStore } from "../src/rag/chroma";
import { GREETING_RESPONSE, SAFETY_REFUSAL } from "../src/rag/safety";
import { EmbeddedChunk, RetrievalCandidate } from "../src/rag/types";
import { classifyQuery } from "../src/rag/classify";
import { detectMentionedFund } from "../src/rag/fund-resolver";

const ALL_FUNDS = [
  "HDFC Defence Fund Direct Growth",
  "HDFC Transportation and Logistics Fund Direct Growth",
  "HDFC Pharma and Healthcare Fund Direct Growth",
  "HDFC Manufacturing Fund Direct Growth",
  "HDFC Mid-Cap Fund Direct Plan Growth Option",
  "HDFC Nifty Midcap 150 Index Fund Direct Growth",
  "HDFC Nifty Smallcap 250 Index Fund Direct Growth",
  "HDFC Nifty Next 50 Index Fund Direct Growth",
  "HDFC Nifty 100 Equal Weight Index Fund Direct Growth",
  "HDFC Small Cap Fund Direct Growth Option",
  "HDFC Infrastructure Fund Direct Plan Growth Option",
  "HDFC Nifty50 Equal Weight Index Fund Direct Growth",
  "HDFC Value Fund Direct Plan Growth",
  "HDFC Banking & Financial Services Fund Direct Growth",
];

describe("RAG Eval — 10 scenarios", () => {
  // ----------------------------------------------------------------
  // Q1: Single-fund scheme fact (canonical name)
  // Scenario: user selects one fund, asks for its exit load by full name.
  // Expected: answered with citation from that fund's source.
  // ----------------------------------------------------------------
  it("Q1 — single-fund scheme fact returns an answer with citation", async () => {
    const service = makeService({
      candidates: [schemeFact("src_001", "HDFC Defence Fund Direct Growth", "Exit load is 1% if redeemed within 365 days.", "exit_load")],
      classification: { category: "scheme_fact", extracted_scheme_name: "HDFC Defence Fund Direct Growth", extracted_fee_type: null, extracted_topic: "exit_load", confidence: 0.95 },
      answer: "Exit load for HDFC Defence Fund Direct Growth is 1% if redeemed within 365 days. Source: src_001. Last checked: 2026-05-01.",
    });

    const res = await service.answerQuestion(
      "What is the exit load on HDFC Defence Fund Direct Growth?",
      ["HDFC Defence Fund Direct Growth"]
    );

    expect(res.status).toBe("answered");
    expect(res.citations.length).toBeGreaterThan(0);
    expect(res.citations[0].source_id).toBe("src_001");
    expect(res.resolved_fund).toBe("HDFC Defence Fund Direct Growth");
  });

  // ----------------------------------------------------------------
  // Q2: Generic fee explanation (no fund named)
  // Scenario: user asks "What is expense ratio?" without naming a fund.
  // Expected: answered from fee_static_001, category fee_explanation.
  // ----------------------------------------------------------------
  it("Q2 — generic fee explanation answered without fund-specific scoping", async () => {
    const service = makeService({
      candidates: [feeExplainer("Expense ratio is the annual fee charged by the fund house for managing the fund.")],
      answer: "Expense ratio is the annual fee charged by the fund house for managing the fund. Source: fee_static_001. Last checked: 2026-05-01.",
    });

    const res = await service.answerQuestion("What is expense ratio?", ALL_FUNDS);

    expect(res.status).toBe("answered");
    expect(res.citations[0].source_id).toBe("fee_static_001");
  });

  // ----------------------------------------------------------------
  // Q3: Multi-source (fund value + fee explanation)
  // Scenario: "What is the exit load of HDFC Value Fund and why is it charged?"
  // Expected: classification is multi_source, retrieves from both sources.
  // ----------------------------------------------------------------
  it("Q3 — multi-source question classifies as multi_source via heuristic", async () => {
    const classification = await classifyQuery(
      "What is the exit load of HDFC Value Fund and why is it charged?"
    );

    expect(classification.category).toBe("multi_source");
    expect(classification.extracted_fee_type).toBe("exit_load");
  });

  // ----------------------------------------------------------------
  // Q4: Process help
  // Scenario: user asks how to download a capital gains statement.
  // Expected: classified as process_help; retrieval targets help_page chunks.
  // ----------------------------------------------------------------
  it("Q4 — process help classifies correctly and bypasses fund scoping", async () => {
    const service = makeService({
      candidates: [helpPage("src_018", "Go to Reports > Tax > Capital Gains Statement.")],
      classification: { category: "process_help", extracted_scheme_name: null, extracted_fee_type: null, extracted_topic: "capital_gains_statement", confidence: 0.9 },
      answer: "Go to Reports > Tax > Capital Gains Statement on Groww. Source: src_018. Last checked: 2026-05-01.",
    });

    const res = await service.answerQuestion(
      "How do I download a capital-gains statement?",
      ["HDFC Defence Fund Direct Growth"]
    );

    expect(res.status).toBe("answered");
    expect(res.citations[0].source_id).toBe("src_018");
  });

  // ----------------------------------------------------------------
  // Q5: Fund mismatch — query names a fund NOT in the user's selection
  // Scenario: user selected Defence only, but asks about Pharma.
  // Expected: fund_mismatch with suggested_fund.
  // ----------------------------------------------------------------
  it("Q5 — fund mismatch returns suggested_fund when fund not in selection", async () => {
    const service = makeService({
      candidates: [],
      classification: { category: "scheme_fact", extracted_scheme_name: null, extracted_fee_type: null, extracted_topic: "nav", confidence: 0.8 },
    });

    const res = await service.answerQuestion(
      "What is the NAV of the pharma fund?",
      ["HDFC Defence Fund Direct Growth"]
    );

    expect(res.status).toBe("fund_mismatch");
    expect(res.suggested_funds).toContain("HDFC Pharma and Healthcare Fund Direct Growth");
    expect(res.answer).toMatch(/not in your current fund selection/i);
  });

  // ----------------------------------------------------------------
  // Q6a: When a fund IS detected but selection is empty → fund_mismatch
  // with the fund name surfaced so the user can add it directly.
  // ----------------------------------------------------------------
  it("Q6a — detected fund with empty selection returns fund_mismatch with fund name", async () => {
    const service = makeService({
      candidates: [schemeFact("src_001", "HDFC Defence Fund Direct Growth", "NAV is Rs. 25.00.", "nav")],
      classification: { category: "scheme_fact", extracted_scheme_name: "HDFC Defence Fund Direct Growth", extracted_fee_type: null, extracted_topic: "nav", confidence: 0.9 },
    });

    const res = await service.answerQuestion(
      "What is the NAV of defence fund?",
      []
    );

    expect(res.status).toBe("fund_mismatch");
    expect(res.suggested_funds).toContain("HDFC Defence Fund Direct Growth");
    expect(res.answer).toMatch(/HDFC Defence Fund Direct Growth/);
  });

  // ----------------------------------------------------------------
  // Q6b: When NO fund is detected and selection is empty → generic refused.
  // ----------------------------------------------------------------
  it("Q6b — no fund detected with empty selection returns generic refused", async () => {
    const service = makeService({
      candidates: [],
      classification: { category: "scheme_fact", extracted_scheme_name: null, extracted_fee_type: null, extracted_topic: "nav", confidence: 0.7 },
    });

    const res = await service.answerQuestion(
      "What is the NAV?",
      []
    );

    expect(res.status).toBe("refused");
    expect(res.answer).toMatch(/select at least one fund/i);
  });

  // ----------------------------------------------------------------
  // Q7: Safety refusal — investment advice
  // Scenario: user asks "Should I buy HDFC Defence Fund?"
  // Expected: refused with the canonical SAFETY_REFUSAL string.
  // ----------------------------------------------------------------
  it("Q7 — investment advice is refused with safety message", async () => {
    const service = makeService({ candidates: [] });

    const res = await service.answerQuestion(
      "Should I buy HDFC Mid-Cap Fund?",
      ALL_FUNDS
    );

    expect(res.status).toBe("refused");
    expect(res.answer).toBe(SAFETY_REFUSAL);
  });

  // ----------------------------------------------------------------
  // Q8: PII masking
  // Scenario: user includes a PAN number in a legitimate question.
  // Expected: answered with pii_masked=true; PAN not forwarded to LLM.
  // ----------------------------------------------------------------
  it("Q8 — PII is masked before reaching the LLM", async () => {
    const queriesSentToLlm: string[] = [];
    const service = makeService({
      candidates: [feeExplainer("Expense ratio is 0.37% for this fund.")],
      queries: queriesSentToLlm,
    });

    const res = await service.answerQuestion(
      "My PAN is BNXPS1234K. What is expense ratio?",
      ALL_FUNDS
    );

    expect(res.pii_masked).toBe(true);
    expect(queriesSentToLlm.some((q) => q.includes("BNXPS1234K"))).toBe(false);
    expect(queriesSentToLlm.some((q) => q.includes("[REDACTED]"))).toBe(true);
  });

  // ----------------------------------------------------------------
  // Q9: Greeting
  // Scenario: user says "Hi there!" as a casual greeting.
  // Expected: answered with the GREETING_RESPONSE, no citations.
  // ----------------------------------------------------------------
  it("Q9 — greeting returns GREETING_RESPONSE with no citations", async () => {
    const service = makeService({
      candidates: [],
      classification: { category: "greeting", extracted_scheme_name: null, extracted_fee_type: null, extracted_topic: null, confidence: 1 },
    });

    const res = await service.answerQuestion("Hi there!", ALL_FUNDS);

    expect(res.status).toBe("answered");
    expect(res.answer).toBe(GREETING_RESPONSE);
    expect(res.citations).toEqual([]);
  });

  // ----------------------------------------------------------------
  // Q10: Short alias detection — "BFSI" resolves to Banking fund
  // Scenario: user types "BFSI fund", which is a short alias.
  // Expected: detectMentionedFund identifies it correctly; if in selection,
  //           the service answers; if not, returns fund_mismatch.
  // ----------------------------------------------------------------
  it("Q10 — short alias 'BFSI' resolves to Banking & Financial Services fund", () => {
    const result = detectMentionedFund("expense ratio of BFSI fund", [
      "HDFC Banking & Financial Services Fund Direct Growth",
    ]);

    expect(result.mentioned).toBe("HDFC Banking & Financial Services Fund Direct Growth");
    expect(result.isInSelection).toBe(true);

    const mismatch = detectMentionedFund("expense ratio of BFSI fund", [
      "HDFC Defence Fund Direct Growth",
    ]);

    expect(mismatch.mentioned).toBe("HDFC Banking & Financial Services Fund Direct Growth");
    expect(mismatch.isInSelection).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeService(opts: {
  candidates?: RetrievalCandidate[];
  classification?: Record<string, unknown>;
  answer?: string;
  queries?: string[];
}): SmartSyncFaqService {
  return createSmartSyncFaqService({
    vectorStore: fakeVectorStore(opts.candidates ?? []),
    llm: fakeLlm(opts),
  });
}

function fakeVectorStore(candidates: RetrievalCandidate[]): VectorStore {
  return {
    async upsert(_chunks: EmbeddedChunk[]) {},
    async query() { return candidates; },
    async getSourceContentHash() { return null; },
    async deleteBySourceId() { return 0; },
    async deleteSourcesExcept() { return 0; },
  };
}

function fakeLlm(opts: {
  classification?: Record<string, unknown>;
  answer?: string;
  queries?: string[];
}): GeminiRagClient {
  return {
    async embedDocuments(texts) { return texts.map(() => [0.1, 0.2, 0.3]); },
    async embedQuery(text) {
      opts.queries?.push(text);
      return [0.1, 0.2, 0.3];
    },
    async classifyJson() {
      return opts.classification ?? {
        category: "fee_explanation",
        extracted_scheme_name: null,
        extracted_fee_type: "expense_ratio",
        extracted_topic: null,
        confidence: 0.9,
      };
    },
    async generateAnswer() {
      return opts.answer ?? "Expense ratio is deducted from fund assets. Source: fee_static_001. Last checked: 2026-05-01.";
    },
    async safetyJson() { return { passed: true }; },
    async rewriteQuery(prompt) {
      const lines = prompt.split("\n").filter(Boolean);
      return lines[lines.length - 1] ?? "";
    },
  };
}

function schemeFact(
  sourceId: string,
  schemeName: string,
  text: string,
  sectionType: string,
): RetrievalCandidate {
  return {
    id: `${sourceId}-${sectionType}`,
    text,
    distance: 0.1,
    cosineScore: 0.9,
    bm25Score: 0,
    relevanceScore: 0.9,
    metadata: {
      source_id: sourceId,
      source_type: "official_url",
      content_type: "scheme_fact",
      title: schemeName,
      url: `https://groww.in/mutual-funds/${schemeName.toLowerCase().replace(/\s+/g, "-")}`,
      last_checked: "2026-05-01",
      content_hash: "hash",
      chunk_index: 0,
      scheme_name: schemeName,
      section_type: sectionType,
    },
  };
}

function feeExplainer(text: string): RetrievalCandidate {
  return {
    id: "fee-explain",
    text,
    distance: 0.1,
    cosineScore: 0.9,
    bm25Score: 0,
    relevanceScore: 0.9,
    metadata: {
      source_id: "fee_static_001",
      source_type: "static_fee_explainer",
      content_type: "fee_explanation",
      title: "Approved Fee Explainer",
      url: null,
      last_checked: "2026-05-01",
      content_hash: "hash",
      chunk_index: 0,
      fee_type: "expense_ratio",
    },
  };
}

function helpPage(sourceId: string, text: string): RetrievalCandidate {
  return {
    id: `${sourceId}-help`,
    text,
    distance: 0.1,
    cosineScore: 0.9,
    bm25Score: 0,
    relevanceScore: 0.9,
    metadata: {
      source_id: sourceId,
      source_type: "official_url",
      content_type: "help_page",
      title: "Groww — Download Capital Gains Statement",
      url: "https://groww.in/p/how-to-download-capital-gain-statement",
      last_checked: "2026-05-01",
      content_hash: "hash",
      chunk_index: 0,
    },
  };
}
