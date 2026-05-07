import { NextRequest, NextResponse } from "next/server";

import { createSchedulerDeps } from "@/services/scheduler/server";
import { decryptSecureDetails } from "@/services/scheduler/secure-details";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const deps = createSchedulerDeps();
    const action = await deps.repository.getHitlAction(params.id);
    if (!action) {
      return NextResponse.json({ error: "HITL action not found." }, { status: 404 });
    }

    const booking = await deps.repository.getBookingByCode(action.booking_code);
    if (!booking) {
      return NextResponse.json({ error: "Booking not found." }, { status: 404 });
    }

    if (!booking.secure_link_submitted) {
      return NextResponse.json({ submitted: false });
    }

    const submission = await deps.repository.getSecureDetailsForBooking(booking.id);
    if (!submission) {
      return NextResponse.json({ submitted: false });
    }

    const details = decryptSecureDetails(submission.details_ciphertext);
    return NextResponse.json({
      submitted: true,
      customer_email: details.customer_email,
      customer_name: details.customer_name ?? null
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
