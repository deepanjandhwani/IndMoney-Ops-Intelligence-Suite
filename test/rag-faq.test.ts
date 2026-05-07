import { describe, expect, it } from "vitest";

import { createSmartSyncFaqService } from "../src/rag/faq";
import { GeminiRagClient } from "../src/rag/gemini";
import { classifyQuery } from "../src/rag/classify";
import { detectMentionedFund, detectMentionedFunds } from "../src/rag/fund-resolver";
import { GREETING_RESPONSE, SAFETY_REFUSAL, shouldRefuseQuery } from "../src/rag/safety";
import { VectorStore } from "../src/rag/chroma";
import { EmbeddedChunk, RetrievalCandidate } from "../src/rag/types";

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
  "HDFC Banking & Financial Services Fund Direct Growth"
];

describe("Smart-Sync FAQ service (simplified)", () => {
  it("refuses investment advice with the exact safety message", async () => {
    const service = createSmartSyncFaqService({
      vectorStore: fakeVectorStore([]),
      llm: fakeLlm()
    });

    const response = await service.answerQuestion("Which fund will give me 20% returns?", ALL_FUNDS);

    expect(response.status).toBe("refused");
    expect(response.answer).toBe(SAFETY_REFUSAL);
  });

  it("masks PII before embedding lookup", async () => {
    const queries: string[] = [];
    const service = createSmartSyncFaqService({
      vectorStore: fakeVectorStore([candidate()]),
      llm: fakeLlm({ queries })
    });

    const response = await service.answerQuestion(
      "My PAN is ABCDE1234F, what is expense ratio?",
      ALL_FUNDS
    );

    expect(response.pii_masked).toBe(true);
    expect(queries[0]).toContain("[REDACTED]");
    expect(queries[0]).not.toContain("ABCDE1234F");
  });

  it("returns source-limited no-results when ChromaDB is unavailable", async () => {
    const service = createSmartSyncFaqService({
      vectorStore: {
        ...fakeVectorStore([]),
        async query() {
          throw new Error("ECONNREFUSED ChromaDB unavailable");
        }
      },
      llm: fakeLlm()
    });

    const response = await service.answerQuestion("What is the expense ratio?", ALL_FUNDS);

    expect(response.status).toBe("no_results");
    expect(response.health_error).toContain("ECONNREFUSED");
  });

  it("routes generic expense-ratio questions to the approved fee explainer", async () => {
    const classification = await classifyQuery("Can you tell me the expense ratio?", {
      async classifyJson() {
        return {
          category: "scheme_fact",
          extracted_scheme_name: null,
          extracted_fee_type: "expense_ratio",
          extracted_topic: null,
          confidence: 0.9
        };
      }
    });

    expect(classification).toMatchObject({
      category: "fee_explanation",
      extracted_scheme_name: null,
      extracted_fee_type: "expense_ratio"
    });
  });

  it("allows current NAV as a source-backed factual query", () => {
    expect(shouldRefuseQuery("Can you tell me the current NAV of HDFC Nifty Next 50?")).toBe(false);
  });

  it("returns a friendly greeting for 'Wassup' instead of refusing", async () => {
    const service = createSmartSyncFaqService({
      vectorStore: fakeVectorStore([]),
      llm: fakeLlm({ classification: { category: "greeting", extracted_scheme_name: null, extracted_fee_type: null, extracted_topic: null, confidence: 1 } })
    });

    const response = await service.answerQuestion("Wassup", ALL_FUNDS);

    expect(response.status).toBe("answered");
    expect(response.answer).toBe(GREETING_RESPONSE);
    expect(response.citations).toEqual([]);
  });

  it("returns a greeting for 'Hello' via heuristic", async () => {
    const classification = await classifyQuery("Hello");

    expect(classification.category).toBe("greeting");
  });

  it("returns a greeting for 'Hi there' via heuristic", async () => {
    const classification = await classifyQuery("Hi there");

    expect(classification.category).toBe("greeting");
  });

  it("answers when the query matches a fund in the selection", async () => {
    const defenceCandidate: RetrievalCandidate = {
      id: "defence-nav",
      text: "NAV\nHDFC Defence Fund Direct Growth NAV is Rs. 25.00.",
      distance: 0.1,
      cosineScore: 0.9,
      bm25Score: 0,
      relevanceScore: 0.9,
      metadata: {
        source_id: "src_001",
        source_type: "official_url",
        content_type: "scheme_fact",
        title: "HDFC Defence Fund Direct Growth",
        url: "https://groww.in/mutual-funds/hdfc-defence-fund-direct-growth",
        last_checked: "2026-05-01",
        content_hash: "hash",
        chunk_index: 0,
        scheme_name: "HDFC Defence Fund Direct Growth",
        section_type: "nav"
      }
    };
    const service = createSmartSyncFaqService({
      vectorStore: fakeVectorStore([defenceCandidate]),
      llm: fakeLlm({
        classification: {
          category: "scheme_fact",
          extracted_scheme_name: "HDFC Defence Fund Direct Growth",
          extracted_fee_type: null,
          extracted_topic: "nav",
          confidence: 0.9
        },
        answer: "NAV of HDFC Defence Fund Direct Growth is Rs. 25.00. Source: src_001. Last checked: 2026-05-01."
      })
    });

    const response = await service.answerQuestion(
      "What is the NAV of defence fund?",
      ["HDFC Defence Fund Direct Growth", "HDFC Nifty Next 50 Index Fund Direct Growth"]
    );

    expect(response.status).toBe("answered");
  });

  it("returns fund_mismatch when query names a fund not in the selection", async () => {
    const service = createSmartSyncFaqService({
      vectorStore: fakeVectorStore([navCandidate()]),
      llm: fakeLlm({
        classification: {
          category: "scheme_fact",
          extracted_scheme_name: null,
          extracted_fee_type: null,
          extracted_topic: "nav",
          confidence: 0.6
        }
      })
    });

    const response = await service.answerQuestion(
      "NAV of HDFC Pharma and Healthcare Fund Direct Growth?",
      ["HDFC Defence Fund Direct Growth"]
    );

    expect(response.status).toBe("fund_mismatch");
    expect(response.suggested_funds).toContain("HDFC Pharma and Healthcare Fund Direct Growth");
  });

  it("fee_explanation queries work without fund selection", async () => {
    const service = createSmartSyncFaqService({
      vectorStore: fakeVectorStore([candidate()]),
      llm: fakeLlm()
    });

    const response = await service.answerQuestion("What is the expense ratio?", []);

    expect(response.status).toBe("answered");
  });

  it("requires fund selection — refuses scheme_fact when no funds selected", async () => {
    const service = createSmartSyncFaqService({
      vectorStore: fakeVectorStore([candidate()]),
      llm: fakeLlm({
        classification: { category: "scheme_fact", extracted_scheme_name: null, extracted_fee_type: null, extracted_topic: "nav", confidence: 0.9 }
      })
    });

    const response = await service.answerQuestion("What is the NAV?", []);

    expect(response.status).toBe("refused");
    expect(response.answer).toMatch(/select at least one fund/i);
  });

  it("fee explanation questions bypass fund selection filter", async () => {
    const service = createSmartSyncFaqService({
      vectorStore: fakeVectorStore([candidate()]),
      llm: fakeLlm()
    });

    const response = await service.answerQuestion("What is expense ratio?", ALL_FUNDS);

    expect(response.status).toBe("answered");
  });

  it("uses expanded retrieval for broad questions with all funds selected", async () => {
    const queryInputs: { nResults: number; where?: unknown }[] = [];
    const service = createSmartSyncFaqService({
      vectorStore: fakeVectorStore([navCandidate()], { queryInputs }),
      llm: fakeLlm({
        classification: {
          category: "scheme_fact",
          extracted_scheme_name: null,
          extracted_fee_type: null,
          extracted_topic: "nav",
          confidence: 0.9
        },
        answer:
          "HDFC Nifty Next 50 Index Fund Direct Growth NAV is Rs. 10.12. Source: https://groww.in/mutual-funds/hdfc-nifty-next-50-index-fund-direct-growth. Last checked: 2026-05-01."
      })
    });

    const response = await service.answerQuestion("NAV of all funds?", ALL_FUNDS);

    expect(queryInputs[0].nResults).toBeGreaterThanOrEqual(40);
    expect(response.status).toBe("answered");
    expect(response.citations[0].source_id).toBe("src_008");
  });
});

describe("detectMentionedFund", () => {
  it("detects a canonical fund name in the query", () => {
    const result = detectMentionedFund(
      "What is the NAV of HDFC Defence Fund Direct Growth?",
      ALL_FUNDS
    );
    expect(result.mentioned).toBe("HDFC Defence Fund Direct Growth");
    expect(result.isInSelection).toBe(true);
  });

  it("detects a short alias", () => {
    const result = detectMentionedFund(
      "Tell me about the pharma fund",
      ["HDFC Defence Fund Direct Growth"]
    );
    expect(result.mentioned).toBe("HDFC Pharma and Healthcare Fund Direct Growth");
    expect(result.isInSelection).toBe(false);
  });

  it("returns null when no fund is mentioned", () => {
    const result = detectMentionedFund("What is expense ratio?", ALL_FUNDS);
    expect(result.mentioned).toBeNull();
  });

  it("'midcap' matches both Mid-Cap Fund and Nifty Midcap 150 via reverse match", () => {
    const { funds } = detectMentionedFunds("Tell me about midcap fund", ALL_FUNDS);
    const names = funds.map((f) => f.canonical);
    expect(names).toContain("HDFC Mid-Cap Fund Direct Plan Growth Option");
    expect(names).toContain("HDFC Nifty Midcap 150 Index Fund Direct Growth");
  });

  it("'smallcap' matches both Small Cap Fund and Nifty Smallcap 250", () => {
    const { funds } = detectMentionedFunds("smallcap fund details", ALL_FUNDS);
    const names = funds.map((f) => f.canonical);
    expect(names).toContain("HDFC Small Cap Fund Direct Growth Option");
    expect(names).toContain("HDFC Nifty Smallcap 250 Index Fund Direct Growth");
  });
});

function fakeVectorStore(
  candidates: RetrievalCandidate[],
  options: { queryInputs?: { nResults: number; where?: unknown }[] } = {}
): VectorStore {
  return {
    async upsert(_chunks: EmbeddedChunk[]) {},
    async query(input) {
      options.queryInputs?.push({ nResults: input.nResults, where: input.where });
      return candidates;
    },
    async getSourceContentHash() {
      return null;
    },
    async deleteBySourceId() {
      return 0;
    },
    async deleteSourcesExcept() {
      return 0;
    }
  };
}

function fakeLlm(
  options: { queries?: string[]; classification?: Record<string, unknown>; answer?: string } = {}
): GeminiRagClient {
  return {
    async embedDocuments(texts) {
      return texts.map(() => [0.1, 0.2, 0.3]);
    },
    async embedQuery(text) {
      options.queries?.push(text);
      return [0.1, 0.2, 0.3];
    },
    async classifyJson() {
      return options.classification ?? {
        category: "fee_explanation",
        extracted_scheme_name: null,
        extracted_fee_type: "expense_ratio",
        extracted_topic: null,
        confidence: 0.9
      };
    },
    async generateAnswer() {
      return options.answer ?? "Expense ratio is deducted from fund assets. Source: fee_static_001. Last checked: 2026-05-01.";
    },
    async safetyJson() {
      return { passed: true };
    },
    async rewriteQuery(prompt) {
      const lines = prompt.split("\n").filter(Boolean);
      return lines[lines.length - 1] ?? "";
    }
  };
}

function navCandidate(): RetrievalCandidate {
  return {
    id: "nav",
    text: "NAV\nHDFC Nifty Next 50 Index Fund Direct Growth NAV is Rs. 10.12.",
    distance: 0.1,
    cosineScore: 0.9,
    bm25Score: 0,
    relevanceScore: 0.9,
    metadata: {
      source_id: "src_008",
      source_type: "official_url",
      content_type: "scheme_fact",
      title: "HDFC Nifty Next 50 Index Fund Direct Growth",
      url: "https://groww.in/mutual-funds/hdfc-nifty-next-50-index-fund-direct-growth",
      last_checked: "2026-05-01",
      content_hash: "hash",
      chunk_index: 0,
      scheme_name: "HDFC Nifty Next 50 Index Fund Direct Growth",
      section_type: "nav"
    }
  };
}

function candidate(): RetrievalCandidate {
  return {
    id: "fee",
    text: "Expense ratio is deducted from fund assets.",
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
      fee_type: "expense_ratio"
    }
  };
}
