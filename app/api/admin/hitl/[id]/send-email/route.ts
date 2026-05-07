import { NextRequest, NextResponse } from "next/server";

import { createSchedulerDeps } from "@/services/scheduler/server";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = (await request.json()) as { target?: "advisor" | "customer" };
    if (!body.target || !["advisor", "customer"].includes(body.target)) {
      return NextResponse.json(
        { error: 'target must be "advisor" or "customer".' },
        { status: 400 }
      );
    }

    const deps = createSchedulerDeps();
    const action = await deps.repository.getHitlAction(params.id);
    if (!action) {
      return NextResponse.json({ error: "HITL action not found." }, { status: 404 });
    }

    const booking = await deps.repository.getBookingByCode(action.booking_code);
    if (!booking) {
      return NextResponse.json({ error: "Booking not found." }, { status: 404 });
    }

    const draftId =
      body.target === "advisor"
        ? booking.email_draft_id
        : booking.customer_email_draft_id;

    if (!draftId) {
      return NextResponse.json(
        { error: `No ${body.target} email draft exists for this booking.` },
        { status: 404 }
      );
    }

    const result = await deps.integrations.sendEmailDraft(draftId);

    if (body.target === "advisor") {
      await deps.repository.updateBooking(booking.id, { email_draft_status: "sent" });
    } else {
      await deps.repository.updateBooking(booking.id, { customer_email_draft_status: "sent" });
    }

    return NextResponse.json({
      target: body.target,
      message_id: result.message_id,
      status: "sent"
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
