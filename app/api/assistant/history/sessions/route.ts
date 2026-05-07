import {
  assistantHistoryJson,
  getAssistantHistoryRepository,
  getUserIdFromRequest,
  hashDeviceIdFromRequest
} from "../_lib";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const repo = getAssistantHistoryRepository();

  const url = new URL(request.url);
  const deviceHash = hashDeviceIdFromRequest(url.searchParams.get("device_id"));
  if (!deviceHash) {
    return assistantHistoryJson({ error: "device_id query parameter is required." }, { status: 400 });
  }

  try {
    const userId = await getUserIdFromRequest();
    const sessions = await repo.listSessionsForDevice(deviceHash, { limit: 30, userId });
    return assistantHistoryJson({ sessions });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return assistantHistoryJson({ error: message }, { status: 500 });
  }
}
