import { describe, expect, it, vi } from "vitest";

import {
  decideHitlAction,
  SchedulerLifecycleDeps,
  submitSecureDetails
} from "../src/services/scheduler/booking-lifecycle";
import { SchedulerIntegrations } from "../src/services/scheduler/integrations";
import { SchedulerRepository } from "../src/services/scheduler/repository";
import { processSchedulerMessage } from "../src/services/scheduler/state-machine";
import {
  BookingRecord,
  HitlActionRecord,
  SecureDetailsSubmission
} from "../src/services/scheduler/types";

describe("Phase 5 scheduler workflow", () => {
  it("masks PII before scheduler state handling", async () => {
    const { deps } = testDeps();

    const output = await processSchedulerMessage(
      "I want to book an advisor call, my phone is 9876543210",
      undefined,
      deps
    );

    expect(output.pii_warning).toBe(true);
    expect(output.response_text).toContain("personal information");
    expect(output.response_text).not.toContain("9876543210");
    expect(output.next_state).toBe("topic_collection");
  });

  it("propagates one booking code across customer response, Calendar, Sheet, draft, and HITL", async () => {
    const { deps, integrations, repository } = testDeps();
    const bookingOutput = await createBookingThroughChat(deps);
    const bookingCode = bookingOutput.booking_code;

    expect(bookingCode).toMatch(/^[A-Z]{2}-[A-Z][0-9]{3}$/);
    expect(bookingOutput.response_text).toContain(`Booking Code: ${bookingCode}`);
    expect(integrations.calendarHoldTitles[0]).toContain(bookingCode);
    expect(integrations.sheetRows[0].booking_code).toBe(bookingCode);
    expect(integrations.drafts[0].subject).toContain(bookingCode);
    expect(integrations.drafts[0].body).toContain(`Booking Code: ${bookingCode}`);
    expect(repository.hitlActions[0].booking_code).toBe(bookingCode);
    expect(repository.hitlActions[0].payload.booking_code).toBe(bookingCode);
    expect(integrations.attendees).toHaveLength(0);
  });

  it("adds the customer attendee only after secure details and Admin approval", async () => {
    const { deps, integrations, repository } = testDeps();
    const bookingOutput = await createBookingThroughChat(deps);
    const token = bookingOutput.secure_link?.split("/").pop();
    const action = repository.hitlActions[0];

    expect(token).toBeTruthy();
    await decideHitlAction(action.id, "approve", deps);
    expect(integrations.attendees).toHaveLength(0);

    await submitSecureDetails(
      token ?? "",
      {
        customer_email: "customer@example.com",
        customer_name: "Customer One"
      },
      deps
    );

    expect(integrations.attendees).toEqual([
      {
        eventId: "event-1",
        customerEmail: "customer@example.com",
        customerName: "Customer One"
      }
    ]);
    expect(repository.secureDetails[0].details_ciphertext).not.toContain("customer@example.com");
  });

  it("treats book-a-slot phrasing as new booking, not availability-only browse", async () => {
    const { deps } = testDeps();
    const out = await processSchedulerMessage("Can you help me book a slot?", undefined, deps);

    expect(out.context?.intent).toBe("book_new");
    expect(out.next_state).toBe("topic_collection");
    expect(out.response_text).toContain("What would you like the advisor call");
  });

  it("accepts pasted slot timestamp line as well as the slot number", async () => {
    const { deps } = testDeps();
    const start = await processSchedulerMessage("book an advisor call", undefined, deps);
    const topic = await processSchedulerMessage("5", start.context, deps);
    const options = await processSchedulerMessage("Monday", topic.context, deps);
    const label = options.context?.slots_offered?.[0]?.label;
    expect(label).toBeTruthy();

    const pick = await processSchedulerMessage(label ?? "", options.context, deps);

    expect(pick.next_state).toBe("confirmation");
    expect(pick.response_text).toContain("Please confirm your booking");
  });

  it("collects a day/time preference before offering slots", async () => {
    const { deps } = testDeps();
    const start = await processSchedulerMessage("book an advisor call", undefined, deps);
    const topic = await processSchedulerMessage("5", start.context, deps);

    expect(topic.next_state).toBe("time_collection");
    expect(topic.response_text).toContain("What day and time");

    const slots = await processSchedulerMessage("Monday", topic.context, deps);
    expect(slots.next_state).toBe("slot_selection");
    expect(slots.context.preferred_date).toBe("2026-05-04");
    expect(slots.slots_offered).toHaveLength(2);
  });

  it("supports repeat requests and ordinal slot selection", async () => {
    const { deps } = testDeps();
    const start = await processSchedulerMessage("book an advisor call", undefined, deps);
    const topic = await processSchedulerMessage("5", start.context, deps);
    const slots = await processSchedulerMessage("Monday", topic.context, deps);

    const repeated = await processSchedulerMessage("repeat the options", slots.context, deps);
    expect(repeated.response_text).toContain("Which one should I hold");

    const pick = await processSchedulerMessage("second option", slots.context, deps);
    expect(pick.next_state).toBe("confirmation");
    expect(pick.response_text).toContain(slots.slots_offered?.[1]?.label);
  });

  it("keeps booking flow active when user provides a date during time collection", async () => {
    const { deps } = testDeps();
    const start = await processSchedulerMessage("book an advisor call", undefined, deps);
    const topic = await processSchedulerMessage("Can you book a slot for KYC / Onboarding?", start.context, deps);
    const slots = await processSchedulerMessage("Monday morning", topic.context, deps);

    expect(["slot_selection", "offer_waitlist"]).toContain(slots.next_state);
    expect(slots.context.intent).toBe("book_new");
    expect(slots.context.topic).toBe("KYC / Onboarding");
  });

  it("pivots intent when user says 'any slots' during time collection", async () => {
    const { deps } = testDeps();
    const start = await processSchedulerMessage("book an advisor call", undefined, deps);
    const topic = await processSchedulerMessage("1", start.context, deps);
    expect(topic.context.state).toBe("time_collection");

    const pivot = await processSchedulerMessage("Any slots for tomorrow?", topic.context, deps);
    expect(pivot.context.intent).toBe("check_availability");
  });

  it("rejects past dates before reading availability", async () => {
    const { deps, integrations } = testDeps();
    const start = await processSchedulerMessage("book an advisor call", undefined, deps);
    const topic = await processSchedulerMessage("5", start.context, deps);
    const past = await processSchedulerMessage("1 May 2020 afternoon", topic.context, deps);

    expect(past.next_state).toBe("time_collection");
    expect(past.response_text).toContain("past");
    expect(integrations.availabilityReads).toBe(0);
  });

  it("fails closed when advisor availability cannot be read", async () => {
    const { deps, integrations } = testDeps();
    integrations.failAvailability = true;
    const start = await processSchedulerMessage("book an advisor call", undefined, deps);
    const topic = await processSchedulerMessage("5", start.context, deps);
    const failed = await processSchedulerMessage("Monday", topic.context, deps);

    expect(failed.next_state).toBe("time_collection");
    expect(failed.response_text).toContain("couldn't read advisor availability");
    expect(failed.context.slots_offered).toBeUndefined();
  });

  it("pivots to booking code when user asks to reschedule mid topic selection", async () => {
    const { deps } = testDeps();
    const start = await processSchedulerMessage("book an advisor call", undefined, deps);
    expect(start.next_state).toBe("topic_collection");
    expect(start.context?.intent).toBe("book_new");

    const pivot = await processSchedulerMessage("I need to reschedule instead", start.context, deps);

    expect(pivot.response_text).toContain("booking code");
    expect(pivot.response_text).toContain("LL-LDDD");
    expect(pivot.next_state).toBe("booking_code_collection");
    expect(pivot.context?.intent).toBe("reschedule");
    expect(pivot.response_text).not.toContain("could not match that topic");
  });

  it("pivots from booking code step to new booking when user changes mind", async () => {
    const { deps } = testDeps();
    const reschedule = await processSchedulerMessage("I need to reschedule", undefined, deps);
    expect(reschedule.next_state).toBe("booking_code_collection");
    expect(reschedule.context?.intent).toBe("reschedule");

    const pivot = await processSchedulerMessage(
      "Sorry want to go ahead with booking.",
      reschedule.context,
      deps
    );

    expect(pivot.next_state).toBe("topic_collection");
    expect(pivot.context?.intent).toBe("book_new");
    expect(pivot.response_text).toContain("What would you like the advisor call");
    expect(pivot.response_text).not.toContain("valid booking code");
  });

  it("recognizes spoken booking codes during reschedule", async () => {
    const { deps } = testDeps();
    const bookingOutput = await createBookingThroughChat(deps);

    const reschedule = await processSchedulerMessage("I need to reschedule", undefined, deps);
    const codePrompt = await processSchedulerMessage(
      spellBookingCode(bookingOutput.booking_code),
      reschedule.context,
      deps
    );

    expect(codePrompt.next_state).toBe("reschedule_scope");
    expect(codePrompt.context?.booking_code).toBe(bookingOutput.booking_code);
    expect(codePrompt.response_text).toContain("same discussion topic");
  });

  it("reschedule scope 1 keeps topic and asks for new time", async () => {
    const { deps } = testDeps();
    const bookingOutput = await createBookingThroughChat(deps);

    const reschedule = await processSchedulerMessage("I need to reschedule", undefined, deps);
    const scope = await processSchedulerMessage(
      bookingOutput.booking_code ?? "",
      reschedule.context,
      deps
    );
    expect(scope.next_state).toBe("reschedule_scope");

    const timeStep = await processSchedulerMessage("same topic, just new time", scope.context, deps);
    expect(timeStep.next_state).toBe("time_collection");
    expect(timeStep.context?.intent).toBe("reschedule");
    expect(timeStep.context?.topic).toBe("Account Changes / Nominee");
    expect(timeStep.context?.booking_code).toBe(bookingOutput.booking_code);
  });

  it("reschedule scope 2 opens topic menu", async () => {
    const { deps } = testDeps();
    const bookingOutput = await createBookingThroughChat(deps);

    const reschedule = await processSchedulerMessage("I need to reschedule", undefined, deps);
    const scope = await processSchedulerMessage(
      bookingOutput.booking_code ?? "",
      reschedule.context,
      deps
    );

    const topicMenu = await processSchedulerMessage("2", scope.context, deps);
    expect(topicMenu.next_state).toBe("topic_collection");
    expect(topicMenu.context?.intent).toBe("reschedule");
    expect(topicMenu.response_text).toContain("What would you like the advisor call");
  });

  it("asks for the missing letter when voice hears an incomplete reschedule code", async () => {
    const { deps } = testDeps();
    const reschedule = await processSchedulerMessage("I need to re schedule", undefined, deps);

    const codePrompt = await processSchedulerMessage("nldash1234", reschedule.context, deps);

    expect(codePrompt.next_state).toBe("booking_code_collection");
    expect(codePrompt.context?.intent).toBe("reschedule");
    expect(codePrompt.context?.booking_code).toBeUndefined();
    expect(codePrompt.response_text).toContain("I heard NL-1234");
    expect(codePrompt.response_text).toContain("need one letter after the dash");
  });

  it("pivots from cancellation confirm to new booking when user changes mind", async () => {
    const { deps } = testDeps();
    const bookingOutput = await createBookingThroughChat(deps);
    const code = bookingOutput.booking_code;
    expect(code).toBeTruthy();

    const cancelStart = await processSchedulerMessage("cancel my booking", undefined, deps);
    const confirmPrompt = await processSchedulerMessage(code ?? "", cancelStart.context, deps);
    expect(confirmPrompt.next_state).toBe("cancellation_confirm");

    const pivot = await processSchedulerMessage(
      "Never mind, I want to schedule a new advisor call instead",
      confirmPrompt.context,
      deps
    );

    expect(pivot.next_state).toBe("topic_collection");
    expect(pivot.context?.intent).toBe("book_new");
    expect(pivot.response_text).toContain("What would you like the advisor call");
  });

  it("keeps Sheet approval_status synced for post-confirmation cancellation", async () => {
    const { deps, integrations, repository } = testDeps();
    const bookingOutput = await createBookingThroughChat(deps);
    const booking = repository.bookings[0];
    await repository.updateBooking(booking.id, { status: "confirmed" });

    const cancelStart = await processSchedulerMessage("cancel my booking", undefined, deps);
    const codePrompt = await processSchedulerMessage(bookingOutput.booking_code ?? "", cancelStart.context, deps);
    await processSchedulerMessage("yes", codePrompt.context, deps);

    expect(repository.bookings[0].status).toBe("cancel_requested");
    expect(integrations.sheetUpdates.at(-1)).toMatchObject({
      bookingCode: booking.booking_code,
      updates: { approval_status: "cancel_requested" }
    });

    const cancelAction = repository.hitlActions.find((action) => action.action_type === "cancel");
    expect(cancelAction).toBeTruthy();
    await decideHitlAction(cancelAction?.id ?? "", "approve", deps);

    expect(repository.bookings[0].status).toBe("cancelled");
    expect(integrations.sheetUpdates.at(-1)).toMatchObject({
      bookingCode: booking.booking_code,
      updates: { approval_status: "cancelled" }
    });
  });
});

async function createBookingThroughChat(deps: SchedulerLifecycleDeps) {
  const start = await processSchedulerMessage("book an advisor call", undefined, deps);
  const topic = await processSchedulerMessage("5", start.context, deps);
  const options = await processSchedulerMessage("Monday", topic.context, deps);
  const slot = await processSchedulerMessage("1", options.context, deps);
  return processSchedulerMessage("yes", slot.context, deps);
}

const DIGIT_WORDS: Record<string, string> = {
  "0": "zero",
  "1": "one",
  "2": "two",
  "3": "three",
  "4": "four",
  "5": "five",
  "6": "six",
  "7": "seven",
  "8": "eight",
  "9": "nine"
};

function spellBookingCode(bookingCode?: string) {
  if (!bookingCode) {
    throw new Error("Missing booking code");
  }

  const [prefix, suffix] = bookingCode.split("-");
  return `${prefix.split("").join(" ")} dash ${suffix[0]} ${suffix
    .slice(1)
    .split("")
    .map((digit) => DIGIT_WORDS[digit])
    .join(" ")}`;
}

function testDeps() {
  vi.stubEnv("SECURE_DETAILS_ENCRYPTION_KEY", "test-secure-details-key");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  vi.stubEnv("GOOGLE_ADVISOR_CALENDAR_ID", "advisor@example.com");

  const repository = new InMemorySchedulerRepository();
  const integrations = new CapturingIntegrations();
  const deps: SchedulerLifecycleDeps = {
    repository,
    integrations,
    appUrl: "http://localhost:3000",
    now: () => new Date("2026-05-01T04:00:00.000Z")
  };
  return { deps, repository, integrations };
}

class InMemorySchedulerRepository implements SchedulerRepository {
  bookings: BookingRecord[] = [];
  hitlActions: HitlActionRecord[] = [];
  secureDetails: SecureDetailsSubmission[] = [];

  async bookingCodeExists(bookingCode: string) {
    return this.bookings.some((booking) => booking.booking_code === bookingCode);
  }

  async getLatestReviewPulse() {
    return {
      top_customer_themes: ["Nominee Updates", "Login Issues", "Statement Downloads"],
      weekly_summary: "Users are asking for clearer flows and faster support."
    };
  }

  async createBooking(input: Parameters<SchedulerRepository["createBooking"]>[0]) {
    const booking: BookingRecord = {
      id: `booking-${this.bookings.length + 1}`,
      booking_code: input.booking_code,
      product: "Groww",
      topic: input.topic,
      slot_start: input.slot_start,
      slot_end: input.slot_end,
      status: "pending_admin_confirmation",
      input_mode: input.input_mode,
      secure_link_submitted: false,
      secure_details_token_hash: input.secure_details_token_hash,
      secure_link_expires_at: input.secure_link_expires_at,
      calendar_status: "pending",
      sheet_status: "pending",
      email_draft_status: "pending",
      created_at: "2026-05-01T04:00:00.000Z"
    };
    this.bookings.push(booking);
    return booking;
  }

  async updateBooking(bookingId: string, patch: Parameters<SchedulerRepository["updateBooking"]>[1]) {
    const index = this.bookings.findIndex((booking) => booking.id === bookingId);
    if (index < 0) {
      throw new Error(`Missing booking ${bookingId}`);
    }
    this.bookings[index] = { ...this.bookings[index], ...patch };
    return this.bookings[index];
  }

  async getBookingByCode(bookingCode: string) {
    return this.bookings.find((booking) => booking.booking_code === bookingCode) ?? null;
  }

  async getBookingBySecureTokenHash(tokenHash: string) {
    return this.bookings.find((booking) => booking.secure_details_token_hash === tokenHash) ?? null;
  }

  async createHitlAction(input: Parameters<SchedulerRepository["createHitlAction"]>[0]) {
    const action: HitlActionRecord = {
      id: `hitl-${this.hitlActions.length + 1}`,
      booking_id: input.booking_id,
      booking_code: input.booking_code,
      action_type: input.action_type,
      status: "pending",
      target_booking_status: input.target_booking_status,
      payload: input.payload,
      calendar_status: input.calendar_status,
      sheet_status: input.sheet_status,
      email_draft_status: input.email_draft_status
    };
    this.hitlActions.push(action);
    return action;
  }

  async updateHitlAction(
    hitlActionId: string,
    patch: Parameters<SchedulerRepository["updateHitlAction"]>[1]
  ) {
    const index = this.hitlActions.findIndex((action) => action.id === hitlActionId);
    if (index < 0) {
      throw new Error(`Missing HITL action ${hitlActionId}`);
    }
    this.hitlActions[index] = { ...this.hitlActions[index], ...patch };
    return this.hitlActions[index];
  }

  async getHitlAction(hitlActionId: string) {
    return this.hitlActions.find((action) => action.id === hitlActionId) ?? null;
  }

  async listHitlActions() {
    return this.hitlActions;
  }

  async getLatestHitlActionForBooking(bookingId: string, actionType?: HitlActionRecord["action_type"]) {
    return (
      [...this.hitlActions]
        .reverse()
        .find(
          (action) =>
            action.booking_id === bookingId && (!actionType || action.action_type === actionType)
        ) ?? null
    );
  }

  async storeSecureDetails(input: Parameters<SchedulerRepository["storeSecureDetails"]>[0]) {
    const submission = { ...input };
    this.secureDetails = this.secureDetails.filter((item) => item.booking_id !== input.booking_id);
    this.secureDetails.push(submission);
    return submission;
  }

  async getSecureDetailsForBooking(bookingId: string) {
    return this.secureDetails.find((item) => item.booking_id === bookingId) ?? null;
  }
}

class CapturingIntegrations implements SchedulerIntegrations {
  calendarHoldTitles: string[] = [];
  sheetRows: Array<Record<string, unknown>> = [];
  sheetUpdates: Array<{ bookingCode: string; updates: Record<string, unknown> }> = [];
  drafts: Array<{ subject: string; body: string }> = [];
  attendees: Array<{ eventId: string; customerEmail: string; customerName?: string }> = [];
  availabilityReads = 0;
  failAvailability = false;

  async readAvailability() {
    this.availabilityReads += 1;
    if (this.failAvailability) {
      throw new Error("Calendar unavailable");
    }
    return {
      advisor_calendar: "advisor@example.com",
      timezone: "Asia/Kolkata",
      window_start: "2026-05-02T09:00:00.000Z",
      window_end: "2026-05-09T18:00:00.000Z",
      slot_duration_minutes: 30,
      busy_periods: [],
      suggested_available_slots: [
        {
          start_time: "2026-05-04T10:30:00.000Z",
          end_time: "2026-05-04T11:00:00.000Z"
        },
        {
          start_time: "2026-05-04T11:30:00.000Z",
          end_time: "2026-05-04T12:00:00.000Z"
        }
      ]
    };
  }

  async createCalendarHold(params: Parameters<SchedulerIntegrations["createCalendarHold"]>[0]) {
    this.calendarHoldTitles.push(params.title);
    return {
      event_id: "event-1",
      status: "created",
      booking_code: params.bookingCode,
      customer_attendee_added: false
    };
  }

  async updateCalendarEvent() {
    return { event_id: "event-1", status: "updated" };
  }

  async cancelCalendarEvent() {
    return { event_id: "event-1", status: "cancelled" };
  }

  async appendSheetRow(rowData: Parameters<SchedulerIntegrations["appendSheetRow"]>[0]) {
    this.sheetRows.push(rowData);
    return { updated_range: "Bookings!A2:I2" };
  }

  async updateSheetRowByBookingCode(
    bookingCode: string,
    updates: Parameters<SchedulerIntegrations["updateSheetRowByBookingCode"]>[1]
  ) {
    this.sheetUpdates.push({ bookingCode, updates });
    return { status: "updated" as const, row: 2, booking_code: bookingCode };
  }

  async createAdvisorEmailDraft(params: Parameters<SchedulerIntegrations["createAdvisorEmailDraft"]>[0]) {
    this.drafts.push({ subject: params.subject, body: params.body });
    return { draft_id: `draft-${this.drafts.length}`, message_id: "message-1", status: "draft_created" };
  }

  async addCustomerAttendee(params: Parameters<SchedulerIntegrations["addCustomerAttendee"]>[0]) {
    this.attendees.push(params);
    return {
      event_id: params.eventId,
      status: "updated",
      customer_attendee_added: true
    };
  }
}
