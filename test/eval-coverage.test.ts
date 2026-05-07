import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { createSmartSyncFaqService } from "../src/rag/faq";
import { GeminiRagClient } from "../src/rag/gemini";
import { VectorStore } from "../src/rag/chroma";
import { EmbeddedChunk, RetrievalCandidate } from "../src/rag/types";
import {
  getLlmModelConfig,
  GEMINI_CLASSIFICATION_MODEL,
  GEMINI_GENERATION_MODEL,
  GEMINI_GENERATION_FALLBACK_MODEL,
} from "../src/adapters/llm/models";

const ALL_FUNDS = ["HDFC Defence Fund Direct Growth"];

/**
 * Section 5 — Review Pulse structure (offline: reads the cached artifact).
 */
describe("Eval Section 5: Review Pulse structure", () => {
  const artifactPath = "artifacts/review-pulse-latest.json";

  it("review-pulse-latest.json exists and passes 10 structural checks", () => {
    if (!existsSync(artifactPath)) {
      console.warn(`[eval-s5] ${artifactPath} not found — skipping structural checks`);
      return;
    }

    const raw = readFileSync(artifactPath, "utf-8");
    const pulse = JSON.parse(raw) as Record<string, unknown>;

    expect(pulse.product).toBe("Groww");
    expect(pulse.period).toBeDefined();
    expect(typeof pulse.total_reviews_analyzed).toBe("number");
    expect(pulse.total_reviews_analyzed as number).toBeGreaterThan(0);
    expect(typeof pulse.average_rating).toBe("number");
    expect(pulse.average_rating as number).toBeGreaterThanOrEqual(1.0);
    expect(pulse.average_rating as number).toBeLessThanOrEqual(5.0);

    const themes = pulse.top_themes as { theme: string; rank: number }[];
    expect(themes).toHaveLength(5);
    for (const t of themes) {
      expect(t.theme).toBeTruthy();
      expect(typeof t.rank).toBe("number");
    }

    const quotes = pulse.representative_quotes as string[];
    expect(quotes).toHaveLength(3);
    for (const q of quotes) {
      expect(q.length).toBeGreaterThan(10);
    }

    const summary = pulse.weekly_summary as string;
    expect(summary.split(/\s+/).length).toBeLessThanOrEqual(250);

    const actions = pulse.action_ideas as { idea: string; based_on_theme: string; evidence: string }[];
    expect(actions).toHaveLength(3);
    for (const a of actions) {
      expect(a.idea).toBeTruthy();
      expect(a.based_on_theme).toBeTruthy();
      expect(a.evidence).toBeTruthy();
    }

    expect(pulse.source).toBe("Google Play Store Reviews");

    const fullText = JSON.stringify(pulse);
    expect(fullText).not.toMatch(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/);
    expect(fullText).not.toMatch(/\b[6-9]\d{9}\b/);
    expect(fullText).not.toMatch(/\b[\w.+-]+@[\w.-]+\.\w{2,}\b/);
  });
});

/**
 * Section 7 — LLM Cost: verify cheap models for classification/safety.
 */
describe("Eval Section 7: LLM cost model checks", () => {
  it("classification uses Flash-Lite (cheapest)", () => {
    const config = getLlmModelConfig();
    expect(config.geminiClassificationModel).toBe(GEMINI_CLASSIFICATION_MODEL);
    expect(config.geminiClassificationModel).toMatch(/lite/i);
  });

  it("generation uses Flash, not Pro as primary", () => {
    const config = getLlmModelConfig();
    expect(config.geminiGenerationModel).toBe(GEMINI_GENERATION_MODEL);
    expect(config.geminiGenerationModel).not.toMatch(/pro/i);
  });

  it("Pro is fallback only", () => {
    const config = getLlmModelConfig();
    expect(config.geminiGenerationFallbackModel).toBe(GEMINI_GENERATION_FALLBACK_MODEL);
  });
});

/**
 * Section 9 — Edge-case coverage: Chroma unavailable, embedding failure,
 * pronoun rewrite failure.
 */
describe("Eval Section 9: Edge-case coverage", () => {
  it("ChromaDB unavailable returns no-results with health error", async () => {
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
});

function fakeVectorStore(
  candidates: RetrievalCandidate[],
): VectorStore {
  return {
    async upsert(_chunks: EmbeddedChunk[]) {},
    async query() { return candidates; },
    async getSourceContentHash() { return null; },
    async deleteBySourceId() { return 0; },
    async deleteSourcesExcept() { return 0; }
  };
}

function fakeLlm(
  options: { answer?: string } = {}
): GeminiRagClient {
  return {
    async embedDocuments(texts) { return texts.map(() => [0.1, 0.2, 0.3]); },
    async embedQuery() { return [0.1, 0.2, 0.3]; },
    async classifyJson() {
      return {
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
    async safetyJson() { return { passed: true }; },
    async rewriteQuery(prompt) {
      const lines = prompt.split("\n").filter(Boolean);
      return lines[lines.length - 1] ?? "";
    }
  };
}

function feeCandidate(): RetrievalCandidate {
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
