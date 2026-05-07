import { NextRequest, NextResponse } from "next/server";

import { createSchedulerDeps } from "@/services/scheduler/server";

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

    const previews: Record<string, unknown> = {};

    if (booking.email_draft_id) {
      try {
        const advisor = await deps.integrations.getEmailDraft(booking.email_draft_id);
        previews.advisor = advisor;
      } catch (e) {
        previews.advisor_error = e instanceof Error ? e.message : String(e);
      }
    }

    if (booking.customer_email_draft_id) {
      try {
        const customer = await deps.integrations.getEmailDraft(booking.customer_email_draft_id);
        previews.customer = customer;
      } catch (e) {
        previews.customer_error = e instanceof Error ? e.message : String(e);
      }
    }

    return NextResponse.json(previews);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
