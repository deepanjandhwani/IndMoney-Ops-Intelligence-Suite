import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/adapters/supabase/server-client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = createSupabaseServerClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const { data: bookings, error } = await supabase
      .from("bookings")
      .select("id, booking_code, topic, slot_start, slot_end, status, input_mode, secure_link_submitted, calendar_status, created_at")
      .eq("customer_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ bookings: bookings ?? [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
