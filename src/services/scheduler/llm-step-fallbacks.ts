import { GoogleGenerativeAI } from "@google/generative-ai";
import { GEMINI_CLASSIFICATION_MODEL } from "../../adapters/llm/models";
import { isSchedulerLlmEnabled } from "./llm-fallback";
import { SCHEDULER_TOPICS, type SchedulerTopic, type SlotOption } from "./types";

const TIMEOUT_MS = 5_000;
const CONFIDENCE_THRESHOLD = 0.6;

// ── Topic fallback ──────────────────────────────────────────────

const TOPIC_PROMPT = `You are a topic classifier for a financial advisor booking scheduler.
The user is choosing a discussion topic for an advisor call.
Available topics (0-indexed):
${SCHEDULER_TOPICS.map((t, i) => `${i}: ${t}`).join("\n")}

Given the user message, pick the best matching topic index.
Return JSON: {"topic_index": <0-4>, "confidence": 0.0-1.0}
If no topic clearly matches, set topic_index to -1.
User message: `;

export type TopicFallbackResult = {
  topic: SchedulerTopic;
  confidence: number;
} | null;

export async function matchTopicLlm(
  userMessage: string
): Promise<TopicFallbackResult> {
  if (!isSchedulerLlmEnabled()) return null;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  try {
    const parsed = await callGeminiJson<{ topic_index?: number; confidence?: number }>(
      apiKey,
      `${TOPIC_PROMPT}"${userMessage}"`
    );

    const idx = typeof parsed.topic_index === "number" ? parsed.topic_index : -1;
    const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;
    if (idx < 0 || idx >= SCHEDULER_TOPICS.length || confidence < CONFIDENCE_THRESHOLD) {
      return null;
    }
    return { topic: SCHEDULER_TOPICS[idx], confidence };
  } catch (err) {
    console.warn("[llm-step-fallback] matchTopic failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

// ── Slot selection fallback ─────────────────────────────────────

export type SlotFallbackResult = {
  slot: SlotOption;
  confidence: number;
} | null;

export async function selectSlotLlm(
  userMessage: string,
  slots: SlotOption[]
): Promise<SlotFallbackResult> {
  if (slots.length === 0) return null;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const slotList = slots.map((s) => `id=${s.id}: ${s.label}`).join("\n");

  const prompt = `You are a slot selector for a financial advisor booking scheduler.
The user is choosing from these available time slots:
${slotList}

Given the user message, pick the best matching slot id.
Return JSON: {"slot_id": "<id>", "confidence": 0.0-1.0}
If no slot clearly matches, set slot_id to "none".
User message: "${userMessage}"`;

  try {
    const parsed = await callGeminiJson<{ slot_id?: string; confidence?: number }>(apiKey, prompt);
    const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;
    if (!parsed.slot_id || parsed.slot_id === "none" || confidence < CONFIDENCE_THRESHOLD) {
      return null;
    }
    const matched = slots.find((s) => s.id === parsed.slot_id);
    return matched ? { slot: matched, confidence } : null;
  } catch (err) {
    console.warn("[llm-step-fallback] selectSlot failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

// ── Confirmation fallback ───────────────────────────────────────

export type ConfirmationFallbackResult = {
  decision: "yes" | "no" | "unclear";
  confidence: number;
};

const CONFIRM_PROMPT = `You are a yes/no classifier for a financial advisor booking scheduler.
The user was asked to confirm or decline a booking.
Classify their response as exactly one of: yes, no, unclear.
- "yes" means they agree/confirm (e.g. "sure", "sounds good", "let's do it", "absolutely", "that works")
- "no" means they decline/want to change (e.g. "nah", "not that one", "pick another", "I'd rather not")
- "unclear" means you genuinely cannot tell

Return JSON: {"decision": "yes"|"no"|"unclear", "confidence": 0.0-1.0}
User message: `;

export async function classifyConfirmationLlm(
  userMessage: string
): Promise<ConfirmationFallbackResult | null> {
  if (!isSchedulerLlmEnabled()) return null;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  try {
    const parsed = await callGeminiJson<{ decision?: string; confidence?: number }>(
      apiKey,
      `${CONFIRM_PROMPT}"${userMessage}"`
    );
    const valid = ["yes", "no", "unclear"];
    const decision = valid.includes(parsed.decision as string)
      ? (parsed.decision as "yes" | "no" | "unclear")
      : "unclear";
    const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;

    if (confidence < CONFIDENCE_THRESHOLD) return null;
    return { decision, confidence };
  } catch (err) {
    console.warn("[llm-step-fallback] classifyConfirmation failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

// ── Booking code extraction fallback ────────────────────────────

const BOOKING_CODE_PROMPT = `You are a booking code extractor for a financial advisor scheduler.
Booking codes follow the pattern: two uppercase letters, a dash, one uppercase letter followed by three digits (e.g. NL-A742, AB-C123).
The user might say it informally (e.g. "it's N L dash A 7 4 2", "NL A742", "november lima alpha seven four two").
Speech-to-text often writes the word "dash" or "hyphen" literally or glues it into letters (e.g. "R G dash Y 1 3 3", "GDashY133") — normalize to XX-X999.

Extract the booking code if present. Return JSON: {"booking_code": "XX-X999"|null, "confidence": 0.0-1.0}
If no booking code is present, set booking_code to null.
User message: `;

export type BookingCodeFallbackResult = {
  booking_code: string;
  confidence: number;
} | null;

export async function extractBookingCodeLlm(
  userMessage: string
): Promise<BookingCodeFallbackResult> {
  if (!isSchedulerLlmEnabled()) return null;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  try {
    const parsed = await callGeminiJson<{ booking_code?: string | null; confidence?: number }>(
      apiKey,
      `${BOOKING_CODE_PROMPT}"${userMessage}"`
    );

    const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;
    if (!parsed.booking_code || confidence < CONFIDENCE_THRESHOLD) return null;

    const normalized = parsed.booking_code.toUpperCase().trim();
    if (!/^[A-Z]{2}-[A-Z]\d{3}$/.test(normalized)) return null;

    return { booking_code: normalized, confidence };
  } catch (err) {
    console.warn("[llm-step-fallback] extractBookingCode failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

// ── Shared Gemini helper ────────────────────────────────────────

async function callGeminiJson<T>(apiKey: string, prompt: string): Promise<T> {
  const client = new GoogleGenerativeAI(apiKey);
  const model = client.getGenerativeModel({
    model: process.env.SCHEDULER_LLM_MODEL ?? GEMINI_CLASSIFICATION_MODEL,
    generationConfig: { responseMimeType: "application/json" }
  });

  const result = await withTimeout(model.generateContent(prompt), TIMEOUT_MS);
  const text = result.response.text().trim();
  return JSON.parse(
    text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim()
  ) as T;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`LLM step fallback timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}
