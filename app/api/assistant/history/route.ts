import {
  assistantHistoryJson,
  getAssistantHistoryRepository,
  hashDeviceIdFromRequest
} from "./_lib";

export const runtime = "nodejs";

export async function DELETE(request: Request) {
  const repo = getAssistantHistoryRepository();

  const url = new URL(request.url);
  const deviceHash = hashDeviceIdFromRequest(url.searchParams.get("device_id"));
  if (!deviceHash) {
    return assistantHistoryJson({ error: "device_id query parameter is required." }, { status: 400 });
  }

  try {
    const deletedCount = await repo.deleteAllForDevice(deviceHash);
    return assistantHistoryJson({ ok: true, deleted_count: deletedCount });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return assistantHistoryJson({ error: message }, { status: 500 });
  }
}
