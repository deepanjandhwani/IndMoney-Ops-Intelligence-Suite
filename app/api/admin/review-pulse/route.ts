import { NextResponse } from "next/server";
import { tryCreateSupabaseAdminClient } from "@/adapters/supabase/admin-client";

export async function GET() {
  const client = tryCreateSupabaseAdminClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }

  const { data, error } = await client
    .from("review_pulse")
    .select(
      "id, product, period, total_reviews_analyzed, average_rating, top_themes, representative_quotes, weekly_summary, action_ideas, top_customer_themes, source, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ pulse: data ?? null });
}
