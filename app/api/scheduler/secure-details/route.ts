import { NextRequest, NextResponse } from "next/server";

import { submitSecureDetails } from "@/services/scheduler/booking-lifecycle";
import { createSchedulerDeps } from "@/services/scheduler/server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      token?: string;
      customer_email?: string;
      customer_name?: string;
    };
    const token = body.token?.trim();
    const customerEmail = body.customer_email?.trim();

    if (!token || !customerEmail) {
      return NextResponse.json(
        { error: "Secure token and customer email are required." },
        { status: 400 }
      );
    }

    const result = await submitSecureDetails(
      token,
      {
        customer_email: customerEmail,
        customer_name: body.customer_name?.trim() || undefined
      },
      createSchedulerDeps()
    );

    return NextResponse.json({
      booking_code: result.booking.booking_code,
      attendee_added: result.added
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
