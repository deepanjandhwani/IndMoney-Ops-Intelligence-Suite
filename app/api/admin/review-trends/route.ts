import { NextResponse } from "next/server";
import { tryCreateSupabaseAdminClient } from "@/adapters/supabase/admin-client";

export async function GET() {
  const client = tryCreateSupabaseAdminClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }

  const { data: pulses, error: pulseError } = await client
    .from("review_pulse")
    .select("id, period, total_reviews_analyzed, average_rating, top_themes, created_at")
    .order("created_at", { ascending: true })
    .limit(12);

  if (pulseError) {
    return NextResponse.json({ error: pulseError.message }, { status: 500 });
  }

  const pulseIds = (pulses ?? []).map((p) => p.id);

  let snapshots: Record<string, unknown>[] = [];
  if (pulseIds.length > 0) {
    const { data: snapshotData, error: snapError } = await client
      .from("theme_snapshots")
      .select(
        "pulse_id, theme_name, theme_type, review_count, theme_share_percent, trend_status, wow_change_percent, week_start, week_end"
      )
      .in("pulse_id", pulseIds)
      .order("theme_share_percent", { ascending: false });

    if (snapError) {
      return NextResponse.json({ error: snapError.message }, { status: 500 });
    }
    snapshots = snapshotData ?? [];
  }

  return NextResponse.json({ pulses: pulses ?? [], snapshots });
}
