import { createHash } from "crypto";

export function hashAssistantDeviceId(deviceId: string): string {
  return createHash("sha256").update(deviceId, "utf8").digest("hex");
}
