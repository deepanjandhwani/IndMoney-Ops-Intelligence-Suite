import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/adapters/supabase/server-client";

export const dynamic = "force-dynamic";

const EXCLUDE_PENDING_BADGE = new Set(["cancelled", "rejected"]);

/** Bookings that still need secure details from the customer (excluding dead statuses). */
export async function GET() {
  try {
    const supabase = createSupabaseServerClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const { data, error } = await supabase
      .from("bookings")
      .select("status")
      .eq("customer_id", user.id)
      .eq("secure_link_submitted", false);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const pendingSecureDetailsCount = (data ?? []).filter((row) => !EXCLUDE_PENDING_BADGE.has(row.status)).length;

    return NextResponse.json({ pendingSecureDetailsCount });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
