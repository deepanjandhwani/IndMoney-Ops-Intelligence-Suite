import { GoogleGenerativeAI } from "@google/generative-ai";
import Groq from "groq-sdk";
import { fetch as undiciFetch } from "undici";

import { getLlmModelConfig, getModelForTask, GROQ_PRIMARY_MODEL, GROQ_GENERATION_FALLBACK_MODEL } from "../adapters/llm/models";
import { EMBEDDING_DIMENSIONS } from "./types";

export type GeminiRagClient = {
  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
  classifyJson(prompt: string): Promise<Record<string, unknown>>;
  generateAnswer(prompt: string): Promise<string>;
  safetyJson(prompt: string): Promise<Record<string, unknown>>;
  rewriteQuery(prompt: string): Promise<string>;
};

export function createGeminiRagClient(
  apiKey = process.env.GEMINI_API_KEY,
  env: NodeJS.ProcessEnv = process.env
): GeminiRagClient {
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY");
  }

  const config = getLlmModelConfig(env);
  const client = new GoogleGenerativeAI(apiKey);
  const embeddingModel = client.getGenerativeModel({ model: config.geminiEmbeddingModel });
  const classificationModel = client.getGenerativeModel({
    model: getModelForTask("query_classification", "gemini", config),
    generationConfig: { responseMimeType: "application/json" }
  });
  const generationModel = client.getGenerativeModel({
    model: getModelForTask("rag_answer", "gemini", config)
  });
  const generationFallbackModel =
    config.geminiGenerationFallbackModel !== config.geminiGenerationModel
      ? client.getGenerativeModel({ model: config.geminiGenerationFallbackModel })
      : null;
  const safetyModel = client.getGenerativeModel({
    model: getModelForTask("safety_check", "gemini", config),
    generationConfig: { responseMimeType: "application/json" }
  });

  // Groq — used as primary for classify/safety/rewrite when a key is present.
  // Falls back to Gemini flash-lite on any Groq error so the pipeline never stalls.
  // Also used as the last-resort generation fallback when both Gemini models 503.
  const groqApiKey = env.GROQ_API_KEY;
  const groqClient = groqApiKey ? new Groq({ apiKey: groqApiKey }) : null;
  const groqModel = env.GROQ_CLASSIFICATION_MODEL || GROQ_PRIMARY_MODEL;
  const groqGenerationModel = config.groqGenerationFallbackModel || GROQ_GENERATION_FALLBACK_MODEL;

  let dimensionChecked = false;

  async function assertEmbeddingDimensions(values: number[]) {
    if (dimensionChecked) return;
    dimensionChecked = true;
    if (values.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Embedding model produces ${values.length}-d vectors but EMBEDDING_DIMENSIONS is ${EMBEDDING_DIMENSIONS}. Update EMBEDDING_DIMENSIONS or switch the model.`
      );
    }
  }

  return {
    async embedDocuments(texts) {
      // Bounded parallelism: up to RAG_EMBED_CONCURRENCY in-flight requests
      // (default 3) with a min RAG_EMBED_STAGGER_MS gap between starts to stay
      // under the Gemini 1500 RPM limit. Each embedding result is preserved
      // in input order using indexed slots.
      const concurrency = Math.max(
        1,
        Number(process.env.RAG_EMBED_CONCURRENCY ?? "3")
      );
      const staggerMs = Math.max(0, Number(process.env.RAG_EMBED_STAGGER_MS ?? "120"));
      const embeddings: number[][] = new Array(texts.length);
      let cursor = 0;
      let nextStartAt = Date.now();

      async function worker() {
        while (true) {
          const index = cursor;
          cursor += 1;
          if (index >= texts.length) return;
          if (staggerMs > 0) {
            const wait = Math.max(0, nextStartAt - Date.now());
            nextStartAt = Math.max(Date.now(), nextStartAt) + staggerMs;
            if (wait > 0) await sleep(wait);
          }
          embeddings[index] = await embedWithRetry(
            embeddingModel,
            texts[index],
            "RETRIEVAL_DOCUMENT"
          );
        }
      }

      const workers = Array.from(
        { length: Math.min(concurrency, texts.length) },
        worker
      );
      await Promise.all(workers);
      return embeddings;
    },
    async embedQuery(text) {
      const values = await embedWithRetry(embeddingModel, text, "RETRIEVAL_QUERY");
      await assertEmbeddingDimensions(values);
      return values;
    },
    async classifyJson(prompt) {
      if (groqClient) {
        try {
          return await groqGenerateJson(groqClient, groqModel, prompt, env);
        } catch (err) {
          console.warn("[groq] classifyJson fell back to Gemini:", err instanceof Error ? err.message : err);
        }
      }
      const result = await generateWithRetry(classificationModel, prompt);
      return parseJson(result.response.text());
    },
    async generateAnswer(prompt) {
      try {
        const result = await generateWithRetry(generationModel, prompt, generationFallbackModel);
        return result.response.text().trim();
      } catch (geminiErr) {
        if (groqClient && isRetryableGeminiError(geminiErr)) {
          console.warn("[gemini] generateAnswer falling back to Groq:", geminiErr instanceof Error ? geminiErr.message : geminiErr);
          return await groqGenerateText(groqClient, groqGenerationModel, prompt, env, 2048);
        }
        throw geminiErr;
      }
    },
    async safetyJson(prompt) {
      if (groqClient) {
        try {
          return await groqGenerateJson(groqClient, groqModel, prompt, env);
        } catch (err) {
          console.warn("[groq] safetyJson fell back to Gemini:", err instanceof Error ? err.message : err);
        }
      }
      const result = await generateWithRetry(safetyModel, prompt);
      return parseJson(result.response.text());
    },
    async rewriteQuery(prompt) {
      if (groqClient) {
        try {
          return await groqGenerateText(groqClient, groqModel, prompt, env);
        } catch (err) {
          console.warn("[groq] rewriteQuery fell back to Gemini:", err instanceof Error ? err.message : err);
        }
      }
      const result = await generateWithRetry(classificationModel, prompt);
      const raw = result.response.text().trim();
      try {
        const parsed = parseJson(raw) as { rewritten?: string; question?: string };
        return (parsed.rewritten ?? parsed.question ?? raw).trim();
      } catch {
        return raw;
      }
    }
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableGeminiError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /\b429\b|rate limit|Too Many Requests|503|RESOURCE_EXHAUSTED|fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|timed out/i.test(message);
}

const GENERATE_TIMEOUT_MS = Number(process.env.RAG_GENERATE_TIMEOUT_MS ?? "15000");

type GenerativeModel = { generateContent(prompt: string): Promise<{ response: { text(): string } }> };

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

async function generateWithRetry(
  model: GenerativeModel,
  prompt: string,
  fallbackModel?: GenerativeModel | null
) {
  const maxAttempts = Math.max(1, Number(process.env.RAG_GENERATE_MAX_ATTEMPTS ?? "2"));
  const timeoutMs = GENERATE_TIMEOUT_MS;
  let attempt = 0;
  let lastError: unknown;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      return await withTimeout(model.generateContent(prompt), timeoutMs, `Gemini generate attempt ${attempt}`);
    } catch (error) {
      lastError = error;
      if (!isRetryableGeminiError(error) || attempt >= maxAttempts) {
        break;
      }
      const backoffMs = Math.min(3_000, 1_000 * attempt);
      await sleep(backoffMs);
    }
  }

  if (fallbackModel && isRetryableGeminiError(lastError)) {
    try {
      return await withTimeout(fallbackModel.generateContent(prompt), timeoutMs, "Gemini fallback generate");
    } catch {
      // fallback also failed — throw original error for clarity
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Generation failed after retries.");
}

async function embedWithRetry(
  model: { embedContent(request: unknown): Promise<{ embedding: { values: number[] } }> },
  text: string,
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY"
) {
  const maxAttempts = Math.max(1, Number(process.env.RAG_EMBED_MAX_ATTEMPTS ?? "6"));
  let attempt = 0;
  let lastError: unknown;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      return await embed(model, text, taskType);
    } catch (error) {
      lastError = error;
      if (!isRetryableGeminiError(error) || attempt >= maxAttempts) {
        throw error;
      }
      const backoffMs = Math.min(60_000, 2_000 * 2 ** (attempt - 1));
      await sleep(backoffMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Embedding failed after retries.");
}

async function embed(
  model: { embedContent(request: unknown): Promise<{ embedding: { values: number[] } }> },
  text: string,
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY"
) {
  const response = await model.embedContent({
    content: { role: "user", parts: [{ text }] },
    taskType,
    outputDimensionality: EMBEDDING_DIMENSIONS
  });
  return response.embedding.values;
}

async function groqGenerateJson(
  client: Groq,
  model: string,
  prompt: string,
  env: NodeJS.ProcessEnv
): Promise<Record<string, unknown>> {
  const maxAttempts = Math.max(1, Number(env.RAG_GENERATE_MAX_ATTEMPTS ?? "2"));
  let attempt = 0;
  let lastError: unknown;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      const completion = await client.chat.completions.create({
        model,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_tokens: 512,
        temperature: 0
      });
      return parseJson(completion.choices[0]?.message?.content ?? "{}");
    } catch (error) {
      lastError = error;
      const msg = error instanceof Error ? error.message : String(error);
      if (!/429|rate.limit|too.many/i.test(msg) || attempt >= maxAttempts) break;
      await sleep(1_000 * attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Groq JSON generation failed.");
}

async function groqGenerateText(
  client: Groq,
  model: string,
  prompt: string,
  env: NodeJS.ProcessEnv,
  maxTokens = 256
): Promise<string> {
  const maxAttempts = Math.max(1, Number(env.RAG_GENERATE_MAX_ATTEMPTS ?? "2"));
  let attempt = 0;
  let lastError: unknown;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      const completion = await client.chat.completions.create({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: maxTokens,
        temperature: 0
      });
      return (completion.choices[0]?.message?.content ?? "").trim();
    } catch (error) {
      lastError = error;
      const msg = error instanceof Error ? error.message : String(error);
      if (!/429|rate.limit|too.many/i.test(msg) || attempt >= maxAttempts) break;
      await sleep(1_000 * attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Groq text generation failed.");
}

function parseJson(text: string) {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  return JSON.parse(cleaned) as Record<string, unknown>;
}
