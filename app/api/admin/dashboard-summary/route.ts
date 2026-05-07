import { NextResponse } from "next/server";
import { tryCreateSupabaseAdminClient } from "@/adapters/supabase/admin-client";

export async function GET() {
  const client = tryCreateSupabaseAdminClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }

  const [pulseResult, hitlResult, reviewCountResult, ingestionResult] = await Promise.all([
    client
      .from("review_pulse")
      .select("period, total_reviews_analyzed, average_rating, top_themes, weekly_summary, top_customer_themes, created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    client
      .from("hitl_actions")
      .select("id, booking_code, action_type, status, created_at")
      .order("created_at", { ascending: false })
      .limit(5),
    client
      .from("reviews")
      .select("id", { count: "exact", head: true }),
    client
      .from("ingestion_runs")
      .select("id, source, status, total_fetched, new_stored, duplicates_skipped, errors, created_at")
      .order("created_at", { ascending: false })
      .limit(3)
  ]);

  const pendingCount = (hitlResult.data ?? []).filter((a) => a.status === "pending").length;

  let chromaHealth: { status: string; collection: string | null; error: string | null } = {
    status: "unknown",
    collection: null,
    error: null
  };
  try {
    const chromaUrl = process.env.CHROMA_URL ?? "http://localhost:8001";
    const heartbeat = await fetch(`${chromaUrl}/api/v1/heartbeat`, {
      signal: AbortSignal.timeout(3000)
    });
    chromaHealth = {
      status: heartbeat.ok ? "healthy" : "degraded",
      collection: process.env.CHROMA_COLLECTION ?? "smart-sync-kb",
      error: heartbeat.ok ? null : `HTTP ${heartbeat.status}`
    };
  } catch (e) {
    chromaHealth = {
      status: "unavailable",
      collection: process.env.CHROMA_COLLECTION ?? "smart-sync-kb",
      error: e instanceof Error ? e.message : String(e)
    };
  }

  return NextResponse.json({
    pulse: pulseResult.data ?? null,
    recentHitl: hitlResult.data ?? [],
    totalReviews: reviewCountResult.count ?? 0,
    pendingHitlCount: pendingCount,
    ingestionHealth: {
      recentRuns: ingestionResult.data ?? [],
      chromaDb: chromaHealth
    }
  });
}
