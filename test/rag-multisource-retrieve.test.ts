import { describe, expect, it } from "vitest";

import { retrieveContext } from "../src/rag/retrieve";
import { VectorStore } from "../src/rag/chroma";
import { EmbeddedChunk, QueryClassification, RetrievalCandidate } from "../src/rag/types";

describe("dual expense_ratio + exit_load multi-source", () => {
  it("pins both fund_overview (ER value) and exit_load chunks via backfill if needed", async () => {
    const fund = "HDFC Defence Fund Direct Growth";

    const overview: RetrievalCandidate = {
      id: "chunk-er",
      text: "Fund Overview\nExpense Ratio: 0.78%\nNAV:",
      distance: 0.4,
      cosineScore: 0.6,
      bm25Score: 0,
      relevanceScore: 0.6,
      metadata: {
        source_id: "src_001",
        source_type: "official_url",
        content_type: "scheme_fact",
        title: "HDFC Defence",
        url: "https://groww.in/mutual-funds/hdfc-defence-fund-direct-growth",
        last_checked: "2026-05-01",
        content_hash: "x",
        chunk_index: 0,
        scheme_name: fund,
        section_type: "fund_overview"
      }
    };

    const exitChunk: RetrievalCandidate = {
      id: "chunk-el",
      text: "Exit load of 1%, if redeemed within 1 year.",
      distance: 0.35,
      cosineScore: 0.65,
      bm25Score: 0,
      relevanceScore: 0.65,
      metadata: {
        ...overview.metadata,
        section_type: "exit_load",
        chunk_index: 1
      }
    };

    const fee: RetrievalCandidate = {
      id: "chunk-fee",
      text: "Exit loads discourage short-term withdrawals; expense ratios cover AMC costs.",
      distance: 0.3,
      cosineScore: 0.7,
      bm25Score: 0,
      relevanceScore: 0.7,
      metadata: {
        source_id: "fee_static_001",
        source_type: "static_fee_explainer",
        content_type: "fee_explanation",
        title: "Fee explainer",
        url: null,
        last_checked: "2026-05-01",
        content_hash: "fee",
        chunk_index: 0,
        fee_type: "general_fee",
        scenario: "General Fee"
      }
    };

    const vectorStore: VectorStore = {
      async upsert(_chunks: EmbeddedChunk[]) {},
      async query(input) {
        const w = input.where as Record<string, unknown> | undefined;
        if (w?.source_id === "fee_static_001") return [fee];
        const whereJson = JSON.stringify(input.where ?? {});
        const isExpenseBackfill =
          /expense_ratio|fund_overview/.test(whereJson) &&
          /\$and/.test(whereJson) &&
          /scheme_fact/.test(whereJson);
        if (isExpenseBackfill) return [overview];

        // Primary retrieval: omit overview so pinning must pull ER via backfill
        return [exitChunk];
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

    const classification: QueryClassification = {
      category: "multi_source",
      extracted_scheme_name: fund,
      extracted_fee_type: null,
      extracted_topic: null,
      confidence: 0.85,
      matched_scheme_names: [fund],
      query_scope: "single_fund"
    };

    const query =
      "Expense ratio of HDFC Defence Fund Direct Growth and why was I charged the exit load?";

    const result = await retrieveContext({
      query,
      classification,
      vectorStore,
      llm: {
        async embedQuery() {
          return [0.08, 0.09];
        }
      },
      topK: 8,
      nResults: 16
    });

    const joined = result.map((r) => r.text.toLowerCase()).join("\n");

    expect(result.some((r) => r.text.includes("0.78%"))).toBe(true);
    expect(joined.includes("exit load")).toBe(true);
    expect(result.some((r) => r.metadata.source_id === "fee_static_001")).toBe(true);
  });
});

describe("multi-source retrieval includes fee_static_001", () => {
  it("runs a second vector query for fee_static_001 and keeps fee in merged context", async () => {
    const scheme = cand(
      "s-scheme",
      "Exit load 1% if redeemed within 365 days for this fund.",
      0.12,
      "src_014",
      null
    );
    const fee = cand(
      "s-fee",
      "Mutual fund exit loads depend on the scheme and holding period before redemption.",
      0.18,
      "fee_static_001",
      null
    );

    let queryCount = 0;
    const vectorStore: VectorStore = {
      async upsert(_chunks: EmbeddedChunk[]) {},
      async query(input) {
        queryCount += 1;
        const w = input.where as Record<string, unknown> | undefined;
        if (w && w.source_id === "fee_static_001") {
          return [fee];
        }
        return [scheme];
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

    const classification: QueryClassification = {
      category: "multi_source",
      extracted_scheme_name: "HDFC Banking & Financial Services Fund Direct Growth",
      extracted_fee_type: "exit_load",
      extracted_topic: null,
      confidence: 0.9
    };

    const result = await retrieveContext({
      query: "What is the exit load for HDFC Banking & Financial Services Fund Direct Growth and why might it be charged?",
      classification,
      vectorStore,
      llm: {
        async embedQuery() {
          return [0.1, 0.2, 0.3];
        }
      }
    });

    expect(queryCount).toBe(2);
    expect(result.some((r) => r.metadata.source_id === "fee_static_001")).toBe(true);
    expect(result.some((r) => r.metadata.source_id === "src_014")).toBe(true);
  });
});

function cand(
  id: string,
  text: string,
  distance: number,
  sourceId: string,
  url: string | null
): RetrievalCandidate {
  return {
    id,
    text,
    distance,
    cosineScore: Math.max(0, 1 - distance),
    bm25Score: 0,
    relevanceScore: Math.max(0, 1 - distance),
    metadata: {
      source_id: sourceId,
      source_type: sourceId === "fee_static_001" ? "static_fee_explainer" : "official_url",
      content_type: sourceId === "fee_static_001" ? "fee_explanation" : "scheme_fact",
      title: sourceId === "fee_static_001" ? "Fee explainer" : "Scheme",
      url,
      last_checked: "2026-05-01",
      content_hash: "x",
      chunk_index: 0,
      scheme_name: sourceId === "src_014" ? "HDFC Banking & Financial Services Fund Direct Growth" : undefined
    }
  };
}
