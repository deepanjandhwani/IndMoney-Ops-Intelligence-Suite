import { describe, it, expect, vi, beforeEach } from "vitest";
import { processSchedulerMessage } from "../src/services/scheduler/state-machine";
import type { SchedulerSessionContext } from "../src/services/scheduler/types";
import type { SchedulerLifecycleDeps, SchedulerRepository, SchedulerIntegrations } from "../src/services/scheduler/server";
import type { BookingRecord, HitlActionRecord, SecureDetailsSubmission } from "../src/services/scheduler/types";

vi.mock("../src/services/scheduler/llm-fallback", () => ({
  isSchedulerLlmEnabled: vi.fn(() => true),
  classifyIntentLlm: vi.fn()
}));

vi.mock("../src/services/scheduler/llm-day-resolution", () => ({
  resolveRequestedDay: vi.fn()
}));

vi.mock("../src/services/scheduler/llm-step-fallbacks", () => ({
  matchTopicLlm: vi.fn(),
  selectSlotLlm: vi.fn(),
  classifyConfirmationLlm: vi.fn(),
  extractBookingCodeLlm: vi.fn()
}));

import { classifyIntentLlm } from "../src/services/scheduler/llm-fallback";
import { resolveRequestedDay } from "../src/services/scheduler/llm-day-resolution";
import {
  matchTopicLlm,
  selectSlotLlm,
  classifyConfirmationLlm,
  extractBookingCodeLlm
} from "../src/services/scheduler/llm-step-fallbacks";

const mockedClassifyIntent = vi.mocked(classifyIntentLlm);
const mockedResolveDay = vi.mocked(resolveRequestedDay);
const mockedMatchTopic = vi.mocked(matchTopicLlm);
const mockedSelectSlot = vi.mocked(selectSlotLlm);
const mockedClassifyConfirmation = vi.mocked(classifyConfirmationLlm);
const mockedExtractBookingCode = vi.mocked(extractBookingCodeLlm);

beforeEach(() => {
  vi.resetAllMocks();
  mockedClassifyIntent.mockResolvedValue(null);
  mockedResolveDay.mockResolvedValue(null);
  mockedMatchTopic.mockResolvedValue(null);
  mockedSelectSlot.mockResolvedValue(null);
  mockedClassifyConfirmation.mockResolvedValue(null);
  mockedExtractBookingCode.mockResolvedValue(null);
});

// ─── Intent LLM fallback ───────────────────────────────────────────────────

describe("LLM intent fallback", () => {
  it("uses LLM result when regex returns unclear and LLM confidence >= 0.6", async () => {
    const { deps } = testDeps();
    mockedClassifyIntent.mockResolvedValueOnce({ intent: "book_new", confidence: 0.85 });

    const result = await processSchedulerMessage(
      "I would like to talk to somebody",
      undefined,
      deps
    );

    expect(mockedClassifyIntent).toHaveBeenCalledOnce();
    expect(result.context.intent).toBe("book_new");
    expect(result.context.state).toBe("topic_collection");
  });

  it("stays unclear when LLM confidence < 0.6", async () => {
    const { deps } = testDeps();
    mockedClassifyIntent.mockResolvedValueOnce({ intent: "book_new", confidence: 0.3 });

    const result = await processSchedulerMessage(
      "umm maybe blorp florp",
      undefined,
      deps
    );

    expect(result.context.state).toBe("intent_classification");
    expect(result.response_text).toMatch(/book, reschedule, cancel/);
  });

  it("stays unclear when LLM returns null (timeout/error)", async () => {
    const { deps } = testDeps();

    const result = await processSchedulerMessage(
      "blorp florp",
      undefined,
      deps
    );

    expect(result.context.state).toBe("intent_classification");
  });

  it("does not call LLM when regex succeeds", async () => {
    const { deps } = testDeps();

    const result = await processSchedulerMessage("book an advisor call", undefined, deps);

    expect(mockedClassifyIntent).not.toHaveBeenCalled();
    expect(result.context.intent).toBe("book_new");
  });

  it("routes cancel intent from LLM to booking code collection", async () => {
    const { deps } = testDeps();
    mockedClassifyIntent.mockResolvedValueOnce({ intent: "cancel", confidence: 0.9 });

    const result = await processSchedulerMessage(
      "please get rid of my existing thing",
      undefined,
      deps
    );

    expect(result.context.intent).toBe("cancel");
    expect(result.context.state).toBe("booking_code_collection");
  });
});

// ─── Day resolution LLM fallback ───────────────────────────────────────────

describe("LLM day resolution fallback", () => {
  it("uses LLM result when deterministic parser returns ambiguous", async () => {
    const { deps } = testDeps();
    mockedResolveDay.mockResolvedValueOnce({
      iso_date: "2026-05-04",
      day_label: "Monday, 4 May 2026",
      time_window: null
    });

    const start = await processSchedulerMessage("book an advisor call", undefined, deps);
    const topic = await processSchedulerMessage("1", start.context, deps);
    expect(topic.context.state).toBe("time_collection");

    const time = await processSchedulerMessage(
      "how about the day after the weekend",
      topic.context,
      deps
    );

    expect(mockedResolveDay).toHaveBeenCalledOnce();
    expect(time.context.state).toBe("slot_selection");
  });

  it("prompts again when LLM also returns null", async () => {
    const { deps } = testDeps();
    mockedResolveDay.mockResolvedValueOnce(null);

    const start = await processSchedulerMessage("book an advisor call", undefined, deps);
    const topic = await processSchedulerMessage("1", start.context, deps);

    const time = await processSchedulerMessage(
      "hmm maybe later this week",
      topic.context,
      deps
    );

    expect(time.context.state).toBe("time_collection");
    expect(time.response_text).toMatch(/specific day/i);
  });

  it("does not call LLM when deterministic parser succeeds", async () => {
    const { deps } = testDeps();

    const start = await processSchedulerMessage("book an advisor call", undefined, deps);
    const topic = await processSchedulerMessage("1", start.context, deps);
    const time = await processSchedulerMessage("Monday", topic.context, deps);

    expect(mockedResolveDay).not.toHaveBeenCalled();
    expect(time.context.state).toBe("slot_selection");
  });
});

// ─── Topic LLM fallback ─────────────────────────────────────────────────────

describe("LLM topic fallback", () => {
  it("uses LLM when regex matchTopic returns null", async () => {
    const { deps } = testDeps();
    mockedMatchTopic.mockResolvedValueOnce({ topic: "SIP / Mandates", confidence: 0.85 });

    const start = await processSchedulerMessage("book an advisor call", undefined, deps);
    expect(start.context.state).toBe("topic_collection");

    const result = await processSchedulerMessage(
      "I want to talk about my monthly investments",
      start.context,
      deps
    );

    expect(mockedMatchTopic).toHaveBeenCalledOnce();
    expect(result.context.topic).toBe("SIP / Mandates");
    expect(result.context.state).toBe("time_collection");
  });

  it("re-prompts when LLM topic also returns null", async () => {
    const { deps } = testDeps();

    const start = await processSchedulerMessage("book an advisor call", undefined, deps);
    const result = await processSchedulerMessage(
      "something completely random like pizza",
      start.context,
      deps
    );

    expect(result.response_text).toMatch(/could not match/i);
    expect(result.context.retry_count).toBe(1);
  });

  it("does not call LLM when regex matchTopic succeeds", async () => {
    const { deps } = testDeps();

    const start = await processSchedulerMessage("book an advisor call", undefined, deps);
    await processSchedulerMessage("KYC", start.context, deps);

    expect(mockedMatchTopic).not.toHaveBeenCalled();
  });
});

// ─── Slot selection LLM fallback ────────────────────────────────────────────

describe("LLM slot selection fallback", () => {
  it("uses LLM when deterministic selectSlot returns null", async () => {
    const { deps } = testDeps();

    const start = await processSchedulerMessage("book an advisor call", undefined, deps);
    const topic = await processSchedulerMessage("1", start.context, deps);
    const time = await processSchedulerMessage("Monday", topic.context, deps);
    expect(time.context.state).toBe("slot_selection");
    expect(time.context.slots_offered?.length).toBeGreaterThan(0);

    const targetSlot = time.context.slots_offered![0];
    mockedSelectSlot.mockResolvedValueOnce({ slot: targetSlot, confidence: 0.9 });

    const result = await processSchedulerMessage(
      "give me the earlier one please",
      time.context,
      deps
    );

    expect(mockedSelectSlot).toHaveBeenCalledOnce();
    expect(result.context.state).toBe("confirmation");
    expect(result.context.selected_slot).toBe(targetSlot);
  });

  it("re-prompts when LLM slot selection returns null", async () => {
    const { deps } = testDeps();

    const start = await processSchedulerMessage("book an advisor call", undefined, deps);
    const topic = await processSchedulerMessage("1", start.context, deps);
    const time = await processSchedulerMessage("Monday", topic.context, deps);
    expect(time.context.state).toBe("slot_selection");

    const result = await processSchedulerMessage(
      "what about the purple one",
      time.context,
      deps
    );

    expect(result.response_text).toMatch(/offered slot/i);
  });
});

// ─── Confirmation LLM fallback ──────────────────────────────────────────────

describe("LLM confirmation fallback", () => {
  async function reachConfirmation(deps: SchedulerLifecycleDeps) {
    const start = await processSchedulerMessage("book an advisor call", undefined, deps);
    const topic = await processSchedulerMessage("1", start.context, deps);
    const time = await processSchedulerMessage("Monday", topic.context, deps);
    const slot = await processSchedulerMessage("1", time.context, deps);
    expect(slot.context.state).toBe("confirmation");
    return slot;
  }

  it('uses LLM to detect "yes" from natural language', async () => {
    const { deps } = testDeps();
    const conf = await reachConfirmation(deps);

    mockedClassifyConfirmation.mockResolvedValueOnce({ decision: "yes", confidence: 0.92 });

    const result = await processSchedulerMessage(
      "sounds good, let's do it",
      conf.context,
      deps
    );

    expect(mockedClassifyConfirmation).toHaveBeenCalledOnce();
    expect(result.context.state).toBe("closing");
    expect(result.booking_code).toBeTruthy();
  });

  it('uses LLM to detect "no" from natural language', async () => {
    const { deps } = testDeps();
    const conf = await reachConfirmation(deps);

    mockedClassifyConfirmation.mockResolvedValueOnce({ decision: "no", confidence: 0.88 });

    const result = await processSchedulerMessage(
      "actually I'd rather not",
      conf.context,
      deps
    );

    expect(result.context.state).toBe("slot_selection");
  });

  it("re-prompts when LLM returns unclear", async () => {
    const { deps } = testDeps();
    const conf = await reachConfirmation(deps);

    mockedClassifyConfirmation.mockResolvedValueOnce({ decision: "unclear", confidence: 0.4 });

    const result = await processSchedulerMessage(
      "hmm well I'm not entirely sure what to say here",
      conf.context,
      deps
    );

    expect(result.response_text).toMatch(/yes.*to confirm/i);
  });

  it("does not call LLM when deterministic isYes matches", async () => {
    const { deps } = testDeps();
    const conf = await reachConfirmation(deps);

    await processSchedulerMessage("yes", conf.context, deps);

    expect(mockedClassifyConfirmation).not.toHaveBeenCalled();
  });
});

// ─── Booking code extraction LLM fallback ───────────────────────────────────

describe("LLM booking code extraction fallback", () => {
  it("extracts booking code from spoken input via LLM", async () => {
    const { deps, repository } = testDeps();
    // Seed a booking
    await repository.createBooking({
      booking_code: "NL-A742",
      topic: "KYC / Onboarding",
      slot_start: "2026-05-04T10:30:00.000Z",
      slot_end: "2026-05-04T11:00:00.000Z",
      input_mode: "chat",
      secure_details_token_hash: "hash",
      secure_link_expires_at: "2026-05-11T10:30:00.000Z"
    });

    const start = await processSchedulerMessage(
      "cancel my booking",
      undefined,
      deps
    );
    expect(start.context.state).toBe("booking_code_collection");

    mockedExtractBookingCode.mockResolvedValueOnce({
      booking_code: "NL-A742",
      confidence: 0.88
    });

    const result = await processSchedulerMessage(
      "it's november lima dash alpha seven four two",
      start.context,
      deps
    );

    expect(mockedExtractBookingCode).toHaveBeenCalledOnce();
    expect(result.context.state).toBe("cancellation_confirm");
    expect(result.context.booking_code).toBe("NL-A742");
  });

  it("re-prompts when LLM cannot extract a code", async () => {
    const { deps } = testDeps();

    const start = await processSchedulerMessage("cancel my booking", undefined, deps);
    expect(start.context.state).toBe("booking_code_collection");

    const result = await processSchedulerMessage(
      "I think it was something with letters and numbers",
      start.context,
      deps
    );

    expect(result.response_text).toMatch(/could not find a valid booking code/i);
  });

  it("does not call LLM when regex extracts code directly", async () => {
    const { deps, repository } = testDeps();
    await repository.createBooking({
      booking_code: "NL-A742",
      topic: "KYC / Onboarding",
      slot_start: "2026-05-04T10:30:00.000Z",
      slot_end: "2026-05-04T11:00:00.000Z",
      input_mode: "chat",
      secure_details_token_hash: "hash",
      secure_link_expires_at: "2026-05-11T10:30:00.000Z"
    });

    const start = await processSchedulerMessage("cancel my booking", undefined, deps);
    await processSchedulerMessage("NL-A742", start.context, deps);

    expect(mockedExtractBookingCode).not.toHaveBeenCalled();
  });
});

// ─── Cancellation confirmation LLM fallback ─────────────────────────────────

describe("LLM cancellation confirmation fallback", () => {
  it("accepts natural yes for cancellation", async () => {
    const { deps, repository } = testDeps();
    await repository.createBooking({
      booking_code: "AB-C123",
      topic: "SIP / Mandates",
      slot_start: "2026-05-04T10:30:00.000Z",
      slot_end: "2026-05-04T11:00:00.000Z",
      input_mode: "chat",
      secure_details_token_hash: "hash",
      secure_link_expires_at: "2026-05-11T10:30:00.000Z"
    });

    const start = await processSchedulerMessage("cancel my booking", undefined, deps);
    const code = await processSchedulerMessage("AB-C123", start.context, deps);
    expect(code.context.state).toBe("cancellation_confirm");

    mockedClassifyConfirmation.mockResolvedValueOnce({ decision: "yes", confidence: 0.95 });

    const result = await processSchedulerMessage(
      "absolutely, get rid of it",
      code.context,
      deps
    );

    expect(result.context.state).toBe("terminal");
  });

  it("declines cancellation via natural no", async () => {
    const { deps, repository } = testDeps();
    await repository.createBooking({
      booking_code: "AB-C123",
      topic: "SIP / Mandates",
      slot_start: "2026-05-04T10:30:00.000Z",
      slot_end: "2026-05-04T11:00:00.000Z",
      input_mode: "chat",
      secure_details_token_hash: "hash",
      secure_link_expires_at: "2026-05-11T10:30:00.000Z"
    });

    const start = await processSchedulerMessage("cancel my booking", undefined, deps);
    const code = await processSchedulerMessage("AB-C123", start.context, deps);

    mockedClassifyConfirmation.mockResolvedValueOnce({ decision: "no", confidence: 0.88 });

    const result = await processSchedulerMessage(
      "wait never mind, keep it",
      code.context,
      deps
    );

    expect(result.context.state).toBe("terminal");
    expect(result.response_text).toMatch(/no changes/i);
  });
});

// ─── Feature flag off ───────────────────────────────────────────────────────

describe("feature flag off — no LLM calls", () => {
  it("skips LLM when SCHEDULER_LLM_FALLBACK is not 'true'", async () => {
    const { deps } = testDeps();
    mockedClassifyIntent.mockResolvedValueOnce(null);

    const result = await processSchedulerMessage("something ambiguous", undefined, deps);

    expect(result.context.state).toBe("intent_classification");
  });
});

// ─── test helpers ───────────────────────────────────────────────────────────

function testDeps() {
  vi.stubEnv("SECURE_DETAILS_ENCRYPTION_KEY", "test-secure-details-key");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  vi.stubEnv("GOOGLE_ADVISOR_CALENDAR_ID", "advisor@example.com");
  vi.stubEnv("SCHEDULER_LLM_FALLBACK", "true");

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
    return this.bookings.some((b) => b.booking_code === bookingCode);
  }

  async getLatestReviewPulse() {
    return {
      top_customer_themes: ["Nominee Updates"],
      weekly_summary: "Users are asking for clearer flows."
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
    const index = this.bookings.findIndex((b) => b.id === bookingId);
    if (index < 0) throw new Error(`Missing booking ${bookingId}`);
    this.bookings[index] = { ...this.bookings[index], ...patch };
    return this.bookings[index];
  }

  async getBookingByCode(bookingCode: string) {
    return this.bookings.find((b) => b.booking_code === bookingCode) ?? null;
  }

  async getBookingBySecureTokenHash(tokenHash: string) {
    return this.bookings.find((b) => b.secure_details_token_hash === tokenHash) ?? null;
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

  async updateHitlAction(hitlActionId: string, patch: Parameters<SchedulerRepository["updateHitlAction"]>[1]) {
    const index = this.hitlActions.findIndex((a) => a.id === hitlActionId);
    if (index < 0) throw new Error(`Missing HITL action ${hitlActionId}`);
    this.hitlActions[index] = { ...this.hitlActions[index], ...patch };
    return this.hitlActions[index];
  }

  async getHitlAction(hitlActionId: string) {
    return this.hitlActions.find((a) => a.id === hitlActionId) ?? null;
  }

  async listHitlActions() {
    return this.hitlActions;
  }

  async getLatestHitlActionForBooking(bookingId: string, actionType?: HitlActionRecord["action_type"]) {
    return (
      [...this.hitlActions]
        .reverse()
        .find((a) => a.booking_id === bookingId && (!actionType || a.action_type === actionType)) ?? null
    );
  }

  async storeSecureDetails(input: Parameters<SchedulerRepository["storeSecureDetails"]>[0]) {
    this.secureDetails = this.secureDetails.filter((s) => s.booking_id !== input.booking_id);
    this.secureDetails.push({ ...input });
    return { ...input };
  }

  async getSecureDetailsForBooking(bookingId: string) {
    return this.secureDetails.find((s) => s.booking_id === bookingId) ?? null;
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
    if (this.failAvailability) throw new Error("Calendar unavailable");
    return {
      advisor_calendar: "advisor@example.com",
      timezone: "Asia/Kolkata",
      window_start: "2026-05-02T09:00:00.000Z",
      window_end: "2026-05-09T18:00:00.000Z",
      slot_duration_minutes: 30,
      busy_periods: [],
      suggested_available_slots: [
        { start_time: "2026-05-04T10:30:00.000Z", end_time: "2026-05-04T11:00:00.000Z" },
        { start_time: "2026-05-04T11:30:00.000Z", end_time: "2026-05-04T12:00:00.000Z" }
      ]
    };
  }

  async createCalendarHold(params: Parameters<SchedulerIntegrations["createCalendarHold"]>[0]) {
    this.calendarHoldTitles.push(params.title);
    return { event_id: "event-1", status: "created", booking_code: params.bookingCode, customer_attendee_added: false };
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
    return { event_id: params.eventId, status: "updated", customer_attendee_added: true };
  }
}
