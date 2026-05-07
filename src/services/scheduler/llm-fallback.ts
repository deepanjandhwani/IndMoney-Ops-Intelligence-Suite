import { GoogleGenerativeAI } from "@google/generative-ai";
import Groq from "groq-sdk";
import { GEMINI_CLASSIFICATION_MODEL, GROQ_PRIMARY_MODEL } from "../../adapters/llm/models";
import type { SchedulerIntent } from "./types";

const SCHEDULER_FALLBACK_TIMEOUT_MS = 5_000;

export type SchedulerTurnDecision = {
  intent: SchedulerIntent | "unclear";
  confidence: number;
};

const INTENT_PROMPT = `You are an intent classifier for a financial advisor booking scheduler.
Given the user message, classify into EXACTLY ONE intent:
- book_new: user wants to book / schedule a new advisor call
- reschedule: user wants to change the time of an existing booking
- cancel: user wants to cancel an existing booking
- what_to_prepare: user wants to know what documents / info to prepare
- check_availability: user wants to browse available slots without committing
- unclear: none of the above or truly ambiguous

Return JSON: {"intent": "<intent>", "confidence": 0.0-1.0}
User message: `;

export function isSchedulerLlmEnabled(): boolean {
  return process.env.SCHEDULER_LLM_FALLBACK === "true";
}

export async function classifyIntentLlm(
  userMessage: string
): Promise<SchedulerTurnDecision | null> {
  if (!isSchedulerLlmEnabled()) return null;

  // Prefer Groq for fast, cheap classification
  const groqApiKey = process.env.GROQ_API_KEY;
  if (groqApiKey) {
    try {
      return await classifyIntentViaGroq(userMessage, groqApiKey);
    } catch (err) {
      console.warn("[scheduler-llm-fallback] Groq failed, trying Gemini:", err instanceof Error ? err.message : err);
    }
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  try {
    const client = new GoogleGenerativeAI(apiKey);
    const model = client.getGenerativeModel({
      model: process.env.SCHEDULER_LLM_MODEL ?? GEMINI_CLASSIFICATION_MODEL,
      generationConfig: { responseMimeType: "application/json" }
    });

    const result = await withTimeout(
      model.generateContent(`${INTENT_PROMPT}"${userMessage}"`),
      SCHEDULER_FALLBACK_TIMEOUT_MS
    );
    const text = result.response.text().trim();
    return parseIntentResult(text);
  } catch (err) {
    console.warn("[scheduler-llm-fallback] classifyIntent failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

async function classifyIntentViaGroq(
  userMessage: string,
  apiKey: string
): Promise<SchedulerTurnDecision | null> {
  const client = new Groq({ apiKey });
  const model = process.env.GROQ_CLASSIFICATION_MODEL || GROQ_PRIMARY_MODEL;
  const completion = await withTimeout(
    client.chat.completions.create({
      model,
      messages: [{ role: "user", content: `${INTENT_PROMPT}"${userMessage}"` }],
      response_format: { type: "json_object" },
      max_tokens: 128,
      temperature: 0
    }),
    SCHEDULER_FALLBACK_TIMEOUT_MS
  );
  const text = completion.choices[0]?.message?.content ?? "{}";
  return parseIntentResult(text);
}

function parseIntentResult(text: string): SchedulerTurnDecision | null {
  const parsed = JSON.parse(
    text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim()
  ) as { intent?: string; confidence?: number };

  const validIntents: Array<SchedulerIntent | "unclear"> = [
    "book_new", "reschedule", "cancel", "what_to_prepare", "check_availability", "unclear"
  ];
  const intent = validIntents.includes(parsed.intent as SchedulerIntent)
    ? (parsed.intent as SchedulerIntent | "unclear")
    : "unclear";

  return {
    intent,
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0
  };
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Scheduler LLM fallback timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}
