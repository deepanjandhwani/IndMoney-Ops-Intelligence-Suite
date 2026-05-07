import { NextRequest, NextResponse } from "next/server";

import { decideHitlAction } from "@/services/scheduler/booking-lifecycle";
import { createSchedulerDeps } from "@/services/scheduler/server";
import { HitlStatus } from "@/services/scheduler/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const status = request.nextUrl.searchParams.get("status") as HitlStatus | null;
    const deps = createSchedulerDeps();
    const actions = await deps.repository.listHitlActions(status ?? undefined);
    return NextResponse.json({ actions });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      action_id?: string;
      decision?: "approve" | "reject";
      admin_notes?: string;
    };

    if (!body.action_id || !body.decision) {
      return NextResponse.json(
        { error: "action_id and decision are required." },
        { status: 400 }
      );
    }

    const result = await decideHitlAction(
      body.action_id,
      body.decision,
      createSchedulerDeps(),
      body.admin_notes
    );
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return NextResponse.json({ error: message }, { status: 500 });
}
