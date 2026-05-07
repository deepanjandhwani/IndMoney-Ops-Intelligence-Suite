import { describe, expect, it } from "vitest";

import {
  assertNoRetiredGeminiModel,
  GEMINI_CLASSIFICATION_MODEL,
  GEMINI_EMBEDDING_MODEL,
  GEMINI_GENERATION_MODEL,
  getModelForTask,
  GROQ_CLASSIFICATION_FALLBACK_MODEL,
  LlmModelConfig
} from "../src/adapters/llm/models";

const config: LlmModelConfig = {
  geminiClassificationModel: GEMINI_CLASSIFICATION_MODEL,
  geminiEmbeddingModel: GEMINI_EMBEDDING_MODEL,
  geminiGenerationModel: GEMINI_GENERATION_MODEL,
  groqClassificationFallbackModel: GROQ_CLASSIFICATION_FALLBACK_MODEL
};

describe("LLM model config", () => {
  it("routes generation tasks to Gemini 2.5 Flash", () => {
    expect(getModelForTask("rag_answer", "gemini", config)).toBe(GEMINI_GENERATION_MODEL);
    expect(getModelForTask("what_to_prepare", "gemini", config)).toBe(
      GEMINI_GENERATION_MODEL
    );
  });

  it("routes classification and safety tasks to Gemini 2.5 Flash-Lite", () => {
    expect(getModelForTask("intent_classification", "gemini", config)).toBe(
      GEMINI_CLASSIFICATION_MODEL
    );
    expect(getModelForTask("safety_check", "gemini", config)).toBe(
      GEMINI_CLASSIFICATION_MODEL
    );
  });

  it("allows Groq fallback only for classification and safety", () => {
    expect(getModelForTask("query_classification", "groq", config)).toBe(
      GROQ_CLASSIFICATION_FALLBACK_MODEL
    );
    expect(() => getModelForTask("rag_answer", "groq", config)).toThrow(
      "Groq fallback is allowed only for classification and safety tasks."
    );
  });

  it("rejects retired Gemini models", () => {
    const retiredModel = ["gemini", "2.0", "flash"].join("-");

    expect(() =>
      assertNoRetiredGeminiModel({
        ...config,
        geminiGenerationModel: retiredModel
      })
    ).toThrow("Retired Gemini model configured");
  });
});
