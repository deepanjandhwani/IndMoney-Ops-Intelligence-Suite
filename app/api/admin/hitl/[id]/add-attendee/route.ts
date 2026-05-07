import { NextRequest, NextResponse } from "next/server";

import { addCustomerToCalendar } from "@/services/scheduler/booking-lifecycle";
import { createSchedulerDeps } from "@/services/scheduler/server";

export const dynamic = "force-dynamic";

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const deps = createSchedulerDeps();
    const action = await deps.repository.getHitlAction(params.id);
    if (!action) {
      return NextResponse.json({ error: "HITL action not found." }, { status: 404 });
    }

    const result = await addCustomerToCalendar(action.booking_code, deps);
    return NextResponse.json({
      booking_code: result.booking.booking_code,
      customer_attendee_added: result.added,
      calendar_status: result.booking.calendar_status
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
