import { AssistantSessionOwnershipError } from "@/adapters/supabase/assistant-history-repository";

import {
  assistantHistoryJson,
  getAssistantHistoryRepository,
  getUserIdFromRequest,
  hashDeviceIdFromRequest
} from "../../_lib";

export const runtime = "nodejs";

type RouteContext = { params: { id: string } };

export async function GET(request: Request, context: RouteContext) {
  const repo = getAssistantHistoryRepository();

  const { id: sessionId } = context.params;
  if (!sessionId) {
    return assistantHistoryJson({ error: "Session id is required." }, { status: 400 });
  }

  const url = new URL(request.url);
  const deviceHash = hashDeviceIdFromRequest(url.searchParams.get("device_id"));
  if (!deviceHash) {
    return assistantHistoryJson({ error: "device_id query parameter is required." }, { status: 400 });
  }

  try {
    const userId = await getUserIdFromRequest();
    const events = await repo.getSessionTranscript(sessionId, deviceHash, userId);
    if (!events) {
      return assistantHistoryJson({ error: "Session not found." }, { status: 404 });
    }
    return assistantHistoryJson({ session_id: sessionId, events });
  } catch (err) {
    if (err instanceof AssistantSessionOwnershipError) {
      return assistantHistoryJson({ error: err.message }, { status: 403 });
    }
    const message = err instanceof Error ? err.message : String(err);
    return assistantHistoryJson({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const repo = getAssistantHistoryRepository();

  const { id: sessionId } = context.params;
  if (!sessionId) {
    return assistantHistoryJson({ error: "Session id is required." }, { status: 400 });
  }

  const url = new URL(request.url);
  const deviceHash = hashDeviceIdFromRequest(url.searchParams.get("device_id"));
  if (!deviceHash) {
    return assistantHistoryJson({ error: "device_id query parameter is required." }, { status: 400 });
  }

  try {
    const userId = await getUserIdFromRequest();
    const deleted = await repo.deleteSession(sessionId, deviceHash, userId);
    if (!deleted) {
      return assistantHistoryJson({ error: "Session not found." }, { status: 404 });
    }
    return assistantHistoryJson({ ok: true });
  } catch (err) {
    if (err instanceof AssistantSessionOwnershipError) {
      return assistantHistoryJson({ error: err.message }, { status: 403 });
    }
    const message = err instanceof Error ? err.message : String(err);
    return assistantHistoryJson({ error: message }, { status: 500 });
  }
}
