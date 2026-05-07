import { describe, expect, it } from "vitest";

import { retrieveContext } from "../src/rag/retrieve";
import { VectorStore } from "../src/rag/chroma";
import { EmbeddedChunk, QueryClassification, RetrievalCandidate } from "../src/rag/types";

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
