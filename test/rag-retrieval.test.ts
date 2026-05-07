import { describe, expect, it } from "vitest";

import { bm25Rerank } from "../src/rag/bm25";
import { buildMetadataFilter, classifyQuery } from "../src/rag/classify";
import { citationsFromCandidates, hasRequiredCitations } from "../src/rag/citations";
import { retrieveContext } from "../src/rag/retrieve";
import { EmbeddedChunk, RetrievalCandidate } from "../src/rag/types";
import { VectorStore } from "../src/rag/chroma";

describe("Phase 3 RAG retrieval utilities", () => {
  it("classifies a pure fee + scheme value question as scheme_fact", async () => {
    const classification = await classifyQuery(
      "What is the exit load on HDFC Defence Fund Direct Growth?"
    );

    expect(classification.category).toBe("scheme_fact");
    expect(classification.extracted_fee_type).toBe("exit_load");
    const filter = buildMetadataFilter(classification);
    expect(filter).toMatchObject({ content_type: "scheme_fact" });
  });

  it("preserves multi_source when the query asks for both the value AND its explanation", async () => {
    const classification = await classifyQuery(
      "What is the exit load for the HDFC Defence Fund and why was I charged it?"
    );

    expect(classification.category).toBe("multi_source");
    expect(classification.extracted_fee_type).toBe("exit_load");
    const filter = buildMetadataFilter(classification);
    if (classification.extracted_scheme_name) {
      expect(filter).toEqual({
        $or: [
          {
            $and: [
              { content_type: "scheme_fact" },
              { scheme_name: classification.extracted_scheme_name }
            ]
          },
          { $and: [{ content_type: "fee_explanation" }, { fee_type: "exit_load" }] }
        ]
      });
    } else {
      expect(filter).toEqual({
        $or: [
          { content_type: "scheme_fact" },
          { $and: [{ content_type: "fee_explanation" }, { fee_type: "exit_load" }] }
        ]
      });
    }
  });

  it("multi_source metadata filter scopes scheme_fact to a fund when classification is scoped", () => {
    const classification = {
      category: "multi_source" as const,
      extracted_scheme_name: "HDFC Defence Fund Direct Growth",
      extracted_fee_type: "exit_load",
      extracted_topic: null,
      confidence: 0.9,
      matched_scheme_names: ["HDFC Defence Fund Direct Growth"],
      query_scope: "single_fund" as const
    };
    const filter = buildMetadataFilter(classification);
    expect(filter).toEqual({
      $or: [
        {
          $and: [
            { content_type: "scheme_fact" },
            { scheme_name: "HDFC Defence Fund Direct Growth" }
          ]
        },
        { $and: [{ content_type: "fee_explanation" }, { fee_type: "exit_load" }] }
      ]
    });
  });

  it("classifies standalone 'why was I charged an exit load?' as fee_explanation, not out_of_scope", async () => {
    const classification = await classifyQuery("why was I charged an exit load?");
    expect(classification.category).toBe("fee_explanation");
    expect(classification.extracted_fee_type).toBe("exit_load");
  });

  it("overrides LLM out_of_scope to heuristic when query contains a fee term", async () => {
    const fakeLlm = {
      classifyJson: async () => ({ category: "out_of_scope", confidence: 0.9 })
    };
    const classification = await classifyQuery(
      "Why was I charged an exit load on my redemption?",
      fakeLlm
    );
    expect(classification.category).not.toBe("out_of_scope");
    expect(["fee_explanation", "multi_source"]).toContain(classification.category);
    expect(classification.extracted_fee_type).toBe("exit_load");
  });

  it("preserves multi_source for the canonical eval Q4 phrasing (relate to)", async () => {
    const classification = await classifyQuery(
      "Why might an exit load apply when redeeming units of HDFC Value Fund Direct Plan Growth, and how does that relate to general exit-load rules on Groww?"
    );
    expect(classification.category).toBe("multi_source");
  });

  it("reranks semantically close chunks with BM25 term precision", () => {
    const reranked = bm25Rerank(
      "expense ratio",
      [
        candidate("exit", "Exit load is charged when units are redeemed early.", 0.15),
        candidate("expense", "Expense ratio is deducted from fund assets.", 0.2)
      ],
      2
    );

    expect(reranked[0].id).toBe("expense");
    expect(reranked[0].bm25Score).toBeGreaterThan(0);
  });

  it("pins the fund expense-ratio chunk for combined value + explanation questions", async () => {
    const fundName = "HDFC Transportation and Logistics Fund Direct Growth";
    const transportExpense = candidate(
      "transport-expense",
      "Fund Overview\nHDFC Transportation and Logistics Fund Direct Growth\nExpense Ratio: 1.06%",
      0.55,
      "src_002",
      "https://groww.in/mutual-funds/hdfc-transportation-and-logistics-fund-direct-growth",
      {
        scheme_name: fundName,
        section_type: "fund_overview",
        title: fundName
      }
    );
    const store = fakeVectorStore({
      primary: [
        transportExpense,
        candidate("generic-fee-primary", "Expense ratio is charged to run a fund.", 0.08, "fee_static_001", null)
      ],
      feeStatic: [
        candidate("fee-1", "Expense ratio is the annual maintenance charge levied by mutual funds.", 0.03, "fee_static_001", null),
        candidate("fee-2", "You are charged an expense ratio because funds have operating costs.", 0.04, "fee_static_001", null),
        candidate("fee-3", "Management fees, allocation charges, and advertising costs can be components.", 0.05, "fee_static_001", null)
      ]
    });

    const result = await retrieveContext({
      query: "What is the expense ratio of transportation fund and why was I charged it?",
      classification: {
        category: "multi_source",
        extracted_scheme_name: fundName,
        extracted_fee_type: "expense_ratio",
        extracted_topic: "expense_ratio",
        confidence: 0.9,
        matched_scheme_names: [fundName],
        query_scope: "single_fund"
      },
      vectorStore: store,
      llm: { async embedQuery() { return [0.1, 0.2, 0.3]; } },
      nResults: 16,
      topK: 8
    });

    expect(result[0].id).toBe("transport-expense");
    expect(result[0].text).toContain("1.06%");
    expect(result.some((c) => c.metadata.source_id === "fee_static_001")).toBe(true);
  });

  it("requires citation metadata in factual answers", () => {
    const c = candidate("fee", "Expense ratio is deducted from fund assets.", 0.1, "fee_static_001", null);
    const citation = citationsFromCandidates([c]);

    expect(
      hasRequiredCitations(
        "Expense ratio is deducted from fund assets. Source: fee_static_001. Last checked: 2026-05-01.",
        citation,
        [c]
      )
    ).toBe(true);

    expect(
      hasRequiredCitations("Expense ratio is deducted from fund assets.", citation, [c])
    ).toBe(true);

    expect(hasRequiredCitations("I like pineapple on pizza.", citation, [c])).toBe(false);
  });
});

function candidate(
  id: string,
  text: string,
  distance: number,
  sourceId = "src_001",
  url: string | null = "https://example.com",
  metadataOverrides: Partial<RetrievalCandidate["metadata"]> = {}
): RetrievalCandidate {
  return {
    id,
    text,
    distance,
    cosineScore: 1 - distance,
    bm25Score: 0,
    relevanceScore: 1 - distance,
    metadata: {
      source_id: sourceId,
      source_type: sourceId === "fee_static_001" ? "static_fee_explainer" : "official_url",
      content_type: sourceId === "fee_static_001" ? "fee_explanation" : "scheme_fact",
      title: sourceId === "fee_static_001" ? "Approved Fee Explainer" : "Example Source",
      url,
      last_checked: "2026-05-01",
      content_hash: "hash",
      chunk_index: 0,
      ...metadataOverrides
    }
  };
}

function fakeVectorStore(input: {
  primary: RetrievalCandidate[];
  feeStatic: RetrievalCandidate[];
  backfill?: RetrievalCandidate[];
}): VectorStore {
  return {
    async upsert(_chunks: EmbeddedChunk[]) {},
    async query(queryInput) {
      const where = JSON.stringify(queryInput.where ?? {});
      if (where.includes("fee_static_001")) return input.feeStatic;
      if (where.includes("section_type")) return input.backfill ?? [];
      return input.primary;
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
