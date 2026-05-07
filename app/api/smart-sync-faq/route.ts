import { NextRequest, NextResponse } from "next/server";

import { createChromaVectorStore, isChromaUnavailable, VectorStore } from "@/rag/chroma";
import { createSmartSyncFaqService } from "@/rag/faq";
import { createGeminiRagClient, GeminiRagClient } from "@/rag/gemini";

export const runtime = "nodejs";

let vectorStorePromise: Promise<VectorStore> | null = null;
let llmSingleton: GeminiRagClient | null = null;

function getVectorStore(): Promise<VectorStore> {
  if (!vectorStorePromise) {
    vectorStorePromise = createChromaVectorStore().catch((err) => {
      vectorStorePromise = null;
      throw err;
    });
  }
  return vectorStorePromise;
}

function getLlm(): GeminiRagClient {
  if (!llmSingleton) {
    llmSingleton = createGeminiRagClient();
  }
  return llmSingleton;
}

function parseSelectedFunds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string").slice(0, 20);
}

function parseHistory(raw: unknown): { role: "user" | "assistant"; text: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (x): x is { role: string; text: string } =>
        typeof x === "object" &&
        x !== null &&
        (x.role === "user" || x.role === "assistant") &&
        typeof x.text === "string"
    )
    .slice(-6)
    .map((x) => ({ role: x.role as "user" | "assistant", text: x.text.slice(0, 400) }));
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      question?: unknown;
      selected_funds?: unknown;
      history?: unknown;
    };
    const question = typeof body.question === "string" ? body.question.trim() : "";

    if (!question) {
      return NextResponse.json({ error: "Question is required." }, { status: 400 });
    }

    const selectedFunds = parseSelectedFunds(body.selected_funds);
    const history = parseHistory(body.history);

    const service = createSmartSyncFaqService({
      vectorStore: await getVectorStore(),
      llm: getLlm()
    });
    const answer = await service.answerQuestion(question, selectedFunds, history);

    return NextResponse.json(answer);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown FAQ service error.";
    console.error("[smart-sync-faq] Unhandled error:", errorMessage);

    if (isChromaUnavailable(error)) {
      return NextResponse.json(
        {
          status: "no_results",
          answer: "The FAQ service is temporarily unavailable. Please try again in a moment.",
          citations: [],
          health_error: errorMessage
        },
        { status: 503, headers: { "Retry-After": "30" } }
      );
    }

    return NextResponse.json(
      {
        status: "no_results",
        answer:
          "I don't have enough information from approved sources to answer this question. I can help with facts about exit load, expense ratio, lock-in period, benchmark, riskometer, fee explanations, or statement download steps.",
        citations: [],
        health_error: errorMessage
      },
      { status: 500 }
    );
  }
}
