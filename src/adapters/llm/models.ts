export const GEMINI_GENERATION_MODEL = "gemini-2.5-flash";
export const GEMINI_GENERATION_FALLBACK_MODEL = "gemini-2.5-pro";
export const GEMINI_CLASSIFICATION_MODEL = "gemini-2.5-flash-lite";
export const GEMINI_EMBEDDING_MODEL = "gemini-embedding-001";
// Groq: primary for classify / safety / rewrite — sub-second inference on LPU hardware.
// llama-3.1-8b-instant is the fastest; fall back to llama3-8b-8192 if not available.
export const GROQ_PRIMARY_MODEL = "llama-3.1-8b-instant";
export const GROQ_CLASSIFICATION_FALLBACK_MODEL = "llama3-8b-8192";
// Groq generation fallback: used when Gemini is overloaded (503 / 429).
export const GROQ_GENERATION_FALLBACK_MODEL = "llama-3.3-70b-versatile";

export type LlmTask =
  | "intent_classification"
  | "query_classification"
  | "rag_answer"
  | "review_pulse_action_ideas"
  | "review_pulse_label_refinement"
  | "review_pulse_summary"
  | "safety_check"
  | "what_to_prepare";

export type LlmProvider = "gemini" | "groq";

export type LlmModelConfig = {
  geminiGenerationModel: string;
  geminiGenerationFallbackModel: string;
  geminiClassificationModel: string;
  geminiEmbeddingModel: string;
  groqClassificationFallbackModel: string;
  groqGenerationFallbackModel: string;
};

const CLASSIFICATION_AND_SAFETY_TASKS = new Set<LlmTask>([
  "intent_classification",
  "query_classification",
  "safety_check"
]);

const GENERATION_TASKS = new Set<LlmTask>([
  "rag_answer",
  "review_pulse_action_ideas",
  "review_pulse_label_refinement",
  "review_pulse_summary",
  "what_to_prepare"
]);

const RETIRED_GEMINI_MODEL_FRAGMENT = ["gemini", "2.0"].join("-");

export function getLlmModelConfig(
  env: NodeJS.ProcessEnv = process.env
): LlmModelConfig {
  const config = {
    geminiGenerationModel: env.GEMINI_GENERATION_MODEL ?? GEMINI_GENERATION_MODEL,
    geminiGenerationFallbackModel:
      env.GEMINI_GENERATION_FALLBACK_MODEL ?? GEMINI_GENERATION_FALLBACK_MODEL,
    geminiClassificationModel:
      env.GEMINI_CLASSIFICATION_MODEL ?? GEMINI_CLASSIFICATION_MODEL,
    geminiEmbeddingModel: env.GEMINI_EMBEDDING_MODEL ?? GEMINI_EMBEDDING_MODEL,
    groqClassificationFallbackModel:
      env.GROQ_CLASSIFICATION_MODEL ?? GROQ_CLASSIFICATION_FALLBACK_MODEL,
    groqGenerationFallbackModel:
      env.GROQ_GENERATION_FALLBACK_MODEL ?? GROQ_GENERATION_FALLBACK_MODEL
  };

  assertNoRetiredGeminiModel(config);
  return config;
}

export function getModelForTask(
  task: LlmTask,
  provider: LlmProvider,
  config: LlmModelConfig = getLlmModelConfig()
) {
  if (provider === "groq") {
    if (!CLASSIFICATION_AND_SAFETY_TASKS.has(task)) {
      throw new Error("Groq fallback is allowed only for classification and safety tasks.");
    }

    return config.groqClassificationFallbackModel;
  }

  if (CLASSIFICATION_AND_SAFETY_TASKS.has(task)) {
    return config.geminiClassificationModel;
  }

  if (GENERATION_TASKS.has(task)) {
    return config.geminiGenerationModel;
  }

  throw new Error(`Unhandled LLM task: ${task}`);
}

export function assertNoRetiredGeminiModel(config: LlmModelConfig) {
  const retiredModel = Object.values(config).find((model) =>
    model.toLowerCase().includes(RETIRED_GEMINI_MODEL_FRAGMENT)
  );

  if (retiredModel) {
    throw new Error(`Retired Gemini model configured: ${retiredModel}`);
  }
}
