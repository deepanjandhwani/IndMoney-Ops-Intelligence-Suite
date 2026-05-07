import { NextResponse } from "next/server";
import { tryCreateSupabaseAdminClient } from "@/adapters/supabase/admin-client";

export async function GET() {
  const client = tryCreateSupabaseAdminClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }

  const [pulseResult, hitlResult, reviewCountResult] = await Promise.all([
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
      .select("id", { count: "exact", head: true })
  ]);

  const pendingCount = (hitlResult.data ?? []).filter((a) => a.status === "pending").length;

  return NextResponse.json({
    pulse: pulseResult.data ?? null,
    recentHitl: hitlResult.data ?? [],
    totalReviews: reviewCountResult.count ?? 0,
    pendingHitlCount: pendingCount
  });
}
