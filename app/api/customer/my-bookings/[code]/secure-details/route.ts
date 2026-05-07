import { NextRequest, NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/adapters/supabase/server-client";
import { createSchedulerDeps } from "@/services/scheduler/server";
import {
  encryptSecureDetails,
  SecureDetailsPayload
} from "@/services/scheduler/secure-details";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: { code: string } }
) {
  try {
    const supabase = createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const body = (await request.json()) as {
      customer_email?: string;
      customer_name?: string;
    };
    const customerEmail = body.customer_email?.trim();
    if (!customerEmail) {
      return NextResponse.json({ error: "customer_email is required." }, { status: 400 });
    }

    const deps = createSchedulerDeps();
    const booking = await deps.repository.getBookingByCode(params.code);
    if (!booking) {
      return NextResponse.json({ error: "Booking not found." }, { status: 404 });
    }
    if (booking.customer_id !== user.id) {
      return NextResponse.json({ error: "This booking does not belong to you." }, { status: 403 });
    }
    if (booking.secure_link_submitted) {
      return NextResponse.json({ error: "Details have already been submitted." }, { status: 409 });
    }

    const details: SecureDetailsPayload = {
      customer_email: customerEmail,
      customer_name: body.customer_name?.trim() || undefined
    };

    const tokenHash = booking.secure_details_token_hash ?? `auth-user-${user.id}`;

    await deps.repository.storeSecureDetails({
      booking_id: booking.id,
      booking_code: booking.booking_code,
      token_hash: tokenHash,
      details_ciphertext: encryptSecureDetails(details),
      expires_at: booking.secure_link_expires_at ?? new Date(Date.now() + 7 * 86400_000).toISOString()
    });

    let updated = await deps.repository.updateBooking(booking.id, {
      secure_link_submitted: true
    });

    try {
      const draft = await deps.integrations.createAdvisorEmailDraft({
        to: customerEmail,
        subject: `Booking Confirmation - ${updated.topic} - ${updated.booking_code}`,
        body: [
          "Thank you for scheduling an advisor session with Groww.",
          "",
          `Booking Code: ${updated.booking_code}`,
          `Topic: ${updated.topic}`,
          "",
          "Your booking is pending admin confirmation. You will receive a",
          "calendar invite once the advisor team approves.",
          "",
          "Please keep your booking code handy for any changes."
        ].join("\n")
      });
      updated = await deps.repository.updateBooking(updated.id, {
        customer_email_draft_id: draft.draft_id,
        customer_email_draft_status: "created"
      });
    } catch {
      updated = await deps.repository.updateBooking(updated.id, {
        customer_email_draft_status: "failed"
      });
    }

    const pendingHitl = await deps.repository.getLatestHitlActionForBooking(updated.id);
    if (pendingHitl && pendingHitl.status === "pending") {
      await deps.repository.updateHitlAction(pendingHitl.id, {
        payload: { ...pendingHitl.payload, secure_link_submitted: true }
      });
    }

    return NextResponse.json({
      booking_code: updated.booking_code,
      submitted: true
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
