import {
  AssistantHistoryRole,
  AssistantLane,
  AssistantSessionOwnershipError
} from "@/adapters/supabase/assistant-history-repository";
import { maskPii } from "@/services/safety/pii";

import {
  assistantHistoryJson,
  getAssistantHistoryRepository,
  getUserIdFromRequest,
  hashDeviceIdFromRequest
} from "../_lib";

export const runtime = "nodejs";

const lanes: AssistantLane[] = ["assistant", "rag", "scheduler"];
const roles: AssistantHistoryRole[] = ["user", "assistant"];

function isLane(value: unknown): value is AssistantLane {
  return typeof value === "string" && (lanes as string[]).includes(value);
}

function isRole(value: unknown): value is AssistantHistoryRole {
  return typeof value === "string" && (roles as string[]).includes(value);
}

export async function POST(request: Request) {
  const repo = getAssistantHistoryRepository();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return assistantHistoryJson({ error: "Invalid JSON body." }, { status: 400 });
  }

  const record = body as {
    device_id?: string;
    session_id?: string | null;
    event?: unknown;
  };

  const deviceHash = hashDeviceIdFromRequest(record.device_id);
  if (!deviceHash) {
    return assistantHistoryJson({ error: "device_id is required." }, { status: 400 });
  }

  const event = record.event;
  if (!event || typeof event !== "object") {
    return assistantHistoryJson({ error: "event is required." }, { status: 400 });
  }

  const e = event as Record<string, unknown>;
  if (!isRole(e.role) || !isLane(e.lane) || typeof e.kind !== "string" || !e.kind.trim()) {
    return assistantHistoryJson({ error: "event.role, event.lane, and event.kind are required." }, { status: 400 });
  }
  if (typeof e.content !== "string") {
    return assistantHistoryJson({ error: "event.content must be a string." }, { status: 400 });
  }

  const masked = maskPii(e.content);

  try {
    const userId = await getUserIdFromRequest();

    const sessionId = await repo.ensureSession({
      deviceIdHash: deviceHash,
      sessionId: typeof record.session_id === "string" ? record.session_id : null,
      userId
    });

    const rawSlots = Array.isArray(e.slots) ? normalizeSlots(e.slots) : null;
    const seq = await repo.appendEvent(sessionId, deviceHash, {
      role: e.role,
      lane: e.lane,
      kind: e.kind.trim(),
      content: masked.maskedText,
      pii_masked: masked.findings.length > 0,
      pii_findings: masked.findings,
      citations: e.citations,
      status: typeof e.status === "string" ? e.status : undefined,
      scheduler_state: typeof e.scheduler_state === "string" ? e.scheduler_state : undefined,
      booking_code: typeof e.booking_code === "string" ? e.booking_code : undefined,
      available_funds: e.available_funds,
      slots: rawSlots && rawSlots.length > 0 ? rawSlots : null
    }, userId);

    return assistantHistoryJson({ session_id: sessionId, seq });
  } catch (err) {
    return mapRepoError(err);
  }
}

function normalizeSlots(raw: unknown[]): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.label !== "string") continue;
    out.push({ id: o.id, label: o.label });
  }
  return out;
}

function mapRepoError(err: unknown) {
  if (err instanceof AssistantSessionOwnershipError) {
    return assistantHistoryJson({ error: err.message }, { status: 403 });
  }
  const message = err instanceof Error ? err.message : String(err);
  return assistantHistoryJson({ error: message }, { status: 500 });
}
