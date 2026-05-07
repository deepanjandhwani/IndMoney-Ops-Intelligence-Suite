import { GoogleGenerativeAI } from "@google/generative-ai";
import { GEMINI_CLASSIFICATION_MODEL } from "../../adapters/llm/models";
import { isSchedulerLlmEnabled } from "./llm-fallback";

const SCHEDULER_FALLBACK_TIMEOUT_MS = 5_000;

export type LlmDayResolution = {
  iso_date: string | null;
  day_label: string | null;
  time_window: "morning" | "afternoon" | "evening" | null;
};

const DAY_PROMPT = `You are a date parser for a financial advisor booking scheduler operating in IST (UTC+5:30).
Today is DATE_PLACEHOLDER.
Given the user's message, extract the intended appointment date.

Rules:
- If the user says a weekday name, resolve to the NEXT occurrence (never today).
- "tomorrow" = today + 1, "day after tomorrow" = today + 2.
- Return the date as ISO format YYYY-MM-DD.
- If you cannot determine a date, set iso_date to null.
- Extract time_window: "morning" (before noon), "afternoon" (noon-5pm), "evening" (5pm+), or null.
- day_label: human-friendly label like "Monday, 5 May 2026" or null.

Return JSON: {"iso_date": "YYYY-MM-DD"|null, "day_label": "..."|null, "time_window": "morning"|"afternoon"|"evening"|null}
User message: `;

export async function resolveRequestedDay(
  userMessage: string,
  now: Date
): Promise<LlmDayResolution | null> {
  if (!isSchedulerLlmEnabled()) return null;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const todayIso = now.toISOString().slice(0, 10);

  try {
    const client = new GoogleGenerativeAI(apiKey);
    const model = client.getGenerativeModel({
      model: process.env.SCHEDULER_LLM_MODEL ?? GEMINI_CLASSIFICATION_MODEL,
      generationConfig: { responseMimeType: "application/json" }
    });

    const prompt = DAY_PROMPT.replace("DATE_PLACEHOLDER", todayIso) + `"${userMessage}"`;
    const result = await withTimeout(
      model.generateContent(prompt),
      SCHEDULER_FALLBACK_TIMEOUT_MS
    );
    const text = result.response.text().trim();
    const parsed = JSON.parse(
      text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim()
    ) as { iso_date?: string | null; day_label?: string | null; time_window?: string | null };

    const validWindows = ["morning", "afternoon", "evening"];
    return {
      iso_date: typeof parsed.iso_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.iso_date) ? parsed.iso_date : null,
      day_label: typeof parsed.day_label === "string" ? parsed.day_label : null,
      time_window: validWindows.includes(parsed.time_window as string) ? (parsed.time_window as LlmDayResolution["time_window"]) : null
    };
  } catch (err) {
    console.warn("[scheduler-llm-fallback] resolveRequestedDay failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Scheduler LLM day resolution timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}
