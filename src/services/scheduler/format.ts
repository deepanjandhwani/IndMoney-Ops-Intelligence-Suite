import { SlotOption } from "./types";

export const IST_TIME_ZONE = "Asia/Kolkata";

export function formatSlotIST(startTime: string | Date) {
  const start = typeof startTime === "string" ? new Date(startTime) : startTime;
  const date = start.toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: IST_TIME_ZONE
  });
  const time = start.toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: IST_TIME_ZONE
  });

  return `${date}, ${time} IST`;
}

export function toSlotOptions(
  slots: Array<{ start_time: string; end_time: string }>,
  limit = 5
): SlotOption[] {
  return slots.slice(0, limit).map((slot, index) => ({
    id: String(index + 1),
    start_time: slot.start_time,
    end_time: slot.end_time,
    label: formatSlotIST(slot.start_time)
  }));
}

export function formatOfferedSlots(slots: SlotOption[]) {
  if (slots.length === 0) {
    return "I could not find available advisor slots in the next week. Please try again later.";
  }

  return [
    "Here are the available 30-minute IST slots:",
    ...slots.map((slot) => `${slot.id}. ${slot.label}`),
    "",
    "Reply with the slot number you prefer."
  ].join("\n");
}

export function defaultAvailabilityWindow(now: Date = new Date()) {
  const windowStart = new Date(now);
  windowStart.setDate(windowStart.getDate() + 1);
  windowStart.setHours(9, 0, 0, 0);

  const windowEnd = new Date(windowStart);
  windowEnd.setDate(windowEnd.getDate() + 7);
  windowEnd.setHours(18, 0, 0, 0);

  return {
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString()
  };
}
