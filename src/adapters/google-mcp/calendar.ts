import { callMcpToolJson } from "./mcp-session";

export type CalendarAvailabilityResult = {
  advisor_calendar: string;
  timezone: string;
  window_start: string;
  window_end: string;
  slot_duration_minutes: number;
  busy_periods: Array<{ start?: string; end?: string }>;
  suggested_available_slots: Array<{ start_time: string; end_time: string }>;
};

export type CalendarHoldResult = {
  event_id: string;
  status: string;
  html_link?: string;
  booking_code: string;
  customer_attendee_added: boolean;
};

export type CalendarMutationResult = {
  event_id: string;
  status: string;
  html_link?: string;
  customer_attendee_added?: boolean;
};

export async function readCalendarAvailability(params: {
  advisorCalendar: string;
  windowStart: string;
  windowEnd: string;
  timezone?: string;
  slotDurationMinutes?: number;
}): Promise<CalendarAvailabilityResult> {
  return callMcpToolJson<CalendarAvailabilityResult>("read_calendar_availability", {
    advisor_calendar: params.advisorCalendar,
    window_start: params.windowStart,
    window_end: params.windowEnd,
    timezone: params.timezone ?? "Asia/Kolkata",
    slot_duration_minutes: params.slotDurationMinutes ?? 30
  });
}

export async function createCalendarHold(params: {
  title: string;
  startTime: string;
  endTime: string;
  timezone?: string;
  bookingCode: string;
  advisorCalendar?: string;
  description?: string;
}): Promise<CalendarHoldResult> {
  const advisor =
    params.advisorCalendar?.trim() ||
    envRequired("GOOGLE_ADVISOR_CALENDAR_ID", "calendar hold");
  return callMcpToolJson<CalendarHoldResult>("create_calendar_hold", {
    title: params.title,
    start_time: params.startTime,
    end_time: params.endTime,
    timezone: params.timezone ?? "Asia/Kolkata",
    booking_code: params.bookingCode,
    advisor_calendar: advisor,
    description: params.description ?? ""
  });
}

export async function updateCalendarEvent(params: {
  eventId: string;
  advisorCalendar?: string;
  title?: string;
  startTime?: string;
  endTime?: string;
  endTimezone?: string;
  description?: string;
}): Promise<CalendarMutationResult> {
  const body: Record<string, unknown> = { event_id: params.eventId };
  if (params.advisorCalendar) {
    body.advisor_calendar = params.advisorCalendar;
  }
  if (params.title !== undefined) {
    body.title = params.title;
  }
  if (params.startTime !== undefined) {
    body.start_time = params.startTime;
  }
  if (params.endTime !== undefined) {
    body.end_time = params.endTime;
  }
  if (params.endTimezone !== undefined) {
    body.end_timezone = params.endTimezone;
  }
  if (params.description !== undefined) {
    body.description = params.description;
  }
  return callMcpToolJson<CalendarMutationResult>("update_calendar_event", body);
}

export async function addCustomerAttendee(params: {
  eventId: string;
  customerEmail: string;
  customerName?: string;
  advisorCalendar?: string;
}): Promise<CalendarMutationResult> {
  const body: Record<string, unknown> = {
    event_id: params.eventId,
    customer_email: params.customerEmail
  };
  if (params.customerName !== undefined) {
    body.customer_name = params.customerName;
  }
  if (params.advisorCalendar) {
    body.advisor_calendar = params.advisorCalendar;
  }
  return callMcpToolJson<CalendarMutationResult>("add_customer_attendee", body);
}

export async function cancelCalendarEvent(params: {
  eventId: string;
  advisorCalendar?: string;
}): Promise<{ event_id: string; status: string }> {
  const body: Record<string, unknown> = { event_id: params.eventId };
  if (params.advisorCalendar) {
    body.advisor_calendar = params.advisorCalendar;
  }
  return callMcpToolJson("cancel_calendar_event", body);
}

function envRequired(name: string, context: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    throw new Error(`Missing ${name} for ${context}`);
  }
  return v;
}
