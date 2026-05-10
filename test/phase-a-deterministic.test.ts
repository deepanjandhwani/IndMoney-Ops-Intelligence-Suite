import { describe, it, expect, vi, beforeEach } from "vitest";
import { matchTopic, classifySchedulerIntent, isNo, isNegativeWithoutCancel } from "../src/services/scheduler/topics";
import { resolveDayPreference } from "../src/services/scheduler/time-preference";
import { processSchedulerMessage } from "../src/services/scheduler/state-machine";
import type { SchedulerSessionContext } from "../src/services/scheduler/types";
import type { SchedulerLifecycleDeps, SchedulerRepository, SchedulerIntegrations } from "../src/services/scheduler/server";
import type { BookingRecord, HitlActionRecord, SecureDetailsSubmission } from "../src/services/scheduler/types";

// ─── A1: STT phonetic patterns ──────────────────────────────────────────────

describe("matchTopic — phonetic / STT patterns", () => {
  it("matches spaced letters: k y c", () => {
    expect(matchTopic("k y c")).toBe("KYC / Onboarding");
  });
  it("matches dotted: K.Y.C", () => {
    expect(matchTopic("K.Y.C")).toBe("KYC / Onboarding");
  });
  it("matches phonetic: kay why see", () => {
    expect(matchTopic("kay why see")).toBe("KYC / Onboarding");
  });
  it("matches phonetic variant: kay wye see", () => {
    expect(matchTopic("kay wye see")).toBe("KYC / Onboarding");
  });
  it("matches spaced letters: s i p", () => {
    expect(matchTopic("s i p")).toBe("SIP / Mandates");
  });
  it("matches dotted: S.I.P", () => {
    expect(matchTopic("S.I.P")).toBe("SIP / Mandates");
  });
  it("matches phonetic: ess eye pee", () => {
    expect(matchTopic("ess eye pee")).toBe("SIP / Mandates");
  });
  it("matches capital gain for Statements / Tax Docs", () => {
    expect(matchTopic("capital gain")).toBe("Statements / Tax Docs");
  });
  it("matches spaced withdraw for Withdrawals", () => {
    expect(matchTopic("with draw")).toBe("Withdrawals & Timelines");
  });
  it("matches spaced nominee for Account Changes", () => {
    expect(matchTopic("nomi nee")).toBe("Account Changes / Nominee");
  });
  it("matches no mini (misheard nominee)", () => {
    expect(matchTopic("no mini")).toBe("Account Changes / Nominee");
  });
  it("still matches numeric shortcuts", () => {
    expect(matchTopic("1")).toBe("KYC / Onboarding");
    expect(matchTopic("2")).toBe("SIP / Mandates");
    expect(matchTopic("3")).toBe("Statements / Tax Docs");
    expect(matchTopic("4")).toBe("Withdrawals & Timelines");
    expect(matchTopic("5")).toBe("Account Changes / Nominee");
  });
});

describe("matchTopic — ordering: 'account changes' does not hit KYC", () => {
  it("routes 'account changes' to Account Changes / Nominee", () => {
    expect(matchTopic("account changes")).toBe("Account Changes / Nominee");
  });
  it("routes 'change nominee' to Account Changes / Nominee", () => {
    expect(matchTopic("change nominee")).toBe("Account Changes / Nominee");
  });
});

// ─── A3: cancel disambiguation ─────────────────────────────────────────────

describe("isNo excludes cancel", () => {
  it("no longer matches standalone cancel", () => {
    expect(isNo("cancel")).toBe(false);
  });
  it("still matches 'no'", () => {
    expect(isNo("no")).toBe(true);
  });
  it("still matches 'nope'", () => {
    expect(isNo("nope")).toBe(true);
  });
  it("still matches 'not now'", () => {
    expect(isNo("not now")).toBe(true);
  });
});

describe("isNegativeWithoutCancel", () => {
  it("matches no", () => {
    expect(isNegativeWithoutCancel("no")).toBe(true);
  });
  it("rejects cancel", () => {
    expect(isNegativeWithoutCancel("cancel")).toBe(false);
  });
  it("rejects 'no cancel it' (contains cancel)", () => {
    expect(isNegativeWithoutCancel("no cancel it")).toBe(false);
  });
});

describe("cancel at confirmation triggers intent pivot, not slot re-pick", () => {
  it("routes 'cancel' to intent_classification (intent pivot)", async () => {
    const { deps } = testDeps();
    const start = await processSchedulerMessage("book an advisor call", undefined, deps);
    const topic = await processSchedulerMessage("5", start.context, deps);
    const time = await processSchedulerMessage("Monday", topic.context, deps);
    const slot = await processSchedulerMessage("1", time.context, deps);
    expect(slot.context.state).toBe("confirmation");

    const cancel = await processSchedulerMessage("cancel", slot.context, deps);
    expect(cancel.context.intent).toBe("cancel");
  });
});

// ─── A5: intent switching at every state ────────────────────────────────────

describe("intent pivot from topic_collection", () => {
  it("cancel during topic_collection pivots to cancel flow", async () => {
    const { deps } = testDeps();
    const start = await processSchedulerMessage("book an advisor call", undefined, deps);
    expect(start.context.state).toBe("topic_collection");

    const cancel = await processSchedulerMessage("I want to cancel", start.context, deps);
    expect(cancel.context.intent).toBe("cancel");
    expect(cancel.context.state).toBe("booking_code_collection");
  });

  it("reschedule during topic_collection pivots to reschedule", async () => {
    const { deps } = testDeps();
    const start = await processSchedulerMessage("book an advisor call", undefined, deps);

    const resched = await processSchedulerMessage("reschedule my appointment", start.context, deps);
    expect(resched.context.intent).toBe("reschedule");
    expect(resched.context.state).toBe("booking_code_collection");
  });

  it("what_to_prepare during topic_collection pivots", async () => {
    const { deps } = testDeps();
    const start = await processSchedulerMessage("book an advisor call", undefined, deps);

    const prep = await processSchedulerMessage("what should I prepare before the call?", start.context, deps);
    expect(prep.context.intent).toBe("what_to_prepare");
  });
});

describe("intent pivot from time_collection", () => {
  it("cancel during time_collection pivots to cancel intent", async () => {
    const { deps } = testDeps();
    const start = await processSchedulerMessage("book an advisor call", undefined, deps);
    const topic = await processSchedulerMessage("1", start.context, deps);
    expect(topic.context.state).toBe("time_collection");

    const cancel = await processSchedulerMessage("I want to cancel", topic.context, deps);
    expect(cancel.context.intent).toBe("cancel");
    expect(cancel.context.state).toBe("booking_code_collection");
  });

  it("reschedule during time_collection pivots to reschedule", async () => {
    const { deps } = testDeps();
    const start = await processSchedulerMessage("book an advisor call", undefined, deps);
    const topic = await processSchedulerMessage("1", start.context, deps);
    expect(topic.context.state).toBe("time_collection");

    const resched = await processSchedulerMessage("I want to reschedule my call", topic.context, deps);
    expect(resched.context.intent).toBe("reschedule");
    expect(resched.context.state).toBe("booking_code_collection");
  });

  it("what_to_prepare during time_collection pivots", async () => {
    const { deps } = testDeps();
    const start = await processSchedulerMessage("book an advisor call", undefined, deps);
    const topic = await processSchedulerMessage("1", start.context, deps);

    const prep = await processSchedulerMessage("what documents should I bring?", topic.context, deps);
    expect(prep.context.intent).toBe("what_to_prepare");
  });

  it("date/time input during time_collection still works (no false pivot)", async () => {
    const { deps } = testDeps();
    const start = await processSchedulerMessage("book an advisor call", undefined, deps);
    const topic = await processSchedulerMessage("1", start.context, deps);
    expect(topic.context.state).toBe("time_collection");

    const result = await processSchedulerMessage("Monday", topic.context, deps);
    expect(result.context.intent).toBe("book_new");
    expect(["slot_selection", "offer_waitlist"]).toContain(result.context.state);
  });

  it("'any slots for tomorrow?' stays in booking flow and keeps topic", async () => {
    const { deps } = testDeps();
    const start = await processSchedulerMessage("book an advisor call", undefined, deps);
    const topic = await processSchedulerMessage("1", start.context, deps);
    expect(topic.context.state).toBe("time_collection");
    expect(topic.context.topic).toBe("KYC / Onboarding");

    const result = await processSchedulerMessage("any slots for tomorrow?", topic.context, deps);
    expect(result.context.intent).toBe("book_new");
    expect(result.context.topic).toBe("KYC / Onboarding");
    expect(["slot_selection", "offer_waitlist"]).toContain(result.context.state);
  });

  it("'check availability for Monday' stays in booking flow when topic already chosen", async () => {
    const { deps } = testDeps();
    const start = await processSchedulerMessage("book an advisor call", undefined, deps);
    const topic = await processSchedulerMessage("1", start.context, deps);

    const result = await processSchedulerMessage("check availability for Monday", topic.context, deps);
    expect(result.context.intent).toBe("book_new");
    expect(result.context.topic).toBe("KYC / Onboarding");
    expect(["slot_selection", "offer_waitlist"]).toContain(result.context.state);
  });

  it("pure date input stays in booking flow (no intent match)", async () => {
    const { deps } = testDeps();
    const start = await processSchedulerMessage("book an advisor call", undefined, deps);
    const topic = await processSchedulerMessage("1", start.context, deps);
    expect(topic.context.state).toBe("time_collection");

    const result = await processSchedulerMessage("Monday morning", topic.context, deps);
    expect(result.context.intent).toBe("book_new");
    expect(["slot_selection", "offer_waitlist"]).toContain(result.context.state);
  });

  it("'book a new call' pivots from cancel flow", async () => {
    const { deps } = testDeps();
    const cancelStart = await processSchedulerMessage("cancel my booking", undefined, deps);
    expect(cancelStart.context.intent).toBe("cancel");
    const codeStep = await processSchedulerMessage("never mind, book a new call", cancelStart.context, deps);
    expect(codeStep.context.intent).toBe("book_new");
  });
});

describe("intent pivot from slot_selection", () => {
  it("cancel during slot_selection pivots to cancel flow", async () => {
    const { deps } = testDeps();
    const start = await processSchedulerMessage("book an advisor call", undefined, deps);
    const topic = await processSchedulerMessage("5", start.context, deps);
    const slots = await processSchedulerMessage("Monday", topic.context, deps);
    expect(slots.context.state).toBe("slot_selection");

    const cancel = await processSchedulerMessage("I want to cancel", slots.context, deps);
    expect(cancel.context.intent).toBe("cancel");
    expect(cancel.context.state).toBe("booking_code_collection");
  });

  it("reschedule during slot_selection pivots", async () => {
    const { deps } = testDeps();
    const start = await processSchedulerMessage("book an advisor call", undefined, deps);
    const topic = await processSchedulerMessage("5", start.context, deps);
    const slots = await processSchedulerMessage("Monday", topic.context, deps);
    expect(slots.context.state).toBe("slot_selection");

    const resched = await processSchedulerMessage("reschedule my existing call", slots.context, deps);
    expect(resched.context.intent).toBe("reschedule");
    expect(resched.context.state).toBe("booking_code_collection");
  });

  it("delete during slot_selection pivots to cancel", async () => {
    const { deps } = testDeps();
    const start = await processSchedulerMessage("book an advisor call", undefined, deps);
    const topic = await processSchedulerMessage("5", start.context, deps);
    const slots = await processSchedulerMessage("Monday", topic.context, deps);

    const del = await processSchedulerMessage("delete my booking", slots.context, deps);
    expect(del.context.intent).toBe("cancel");
  });

  it("valid slot pick still works during slot_selection", async () => {
    const { deps } = testDeps();
    const start = await processSchedulerMessage("book an advisor call", undefined, deps);
    const topic = await processSchedulerMessage("5", start.context, deps);
    const slots = await processSchedulerMessage("Monday", topic.context, deps);
    expect(slots.context.state).toBe("slot_selection");

    const pick = await processSchedulerMessage("1", slots.context, deps);
    expect(pick.context.state).toBe("confirmation");
    expect(pick.context.intent).toBe("book_new");
  });
});

describe("intent pivot from confirmation", () => {
  it("cancel during confirmation pivots to cancel flow", async () => {
    const { deps } = testDeps();
    const start = await processSchedulerMessage("book an advisor call", undefined, deps);
    const topic = await processSchedulerMessage("5", start.context, deps);
    const slots = await processSchedulerMessage("Monday", topic.context, deps);
    const pick = await processSchedulerMessage("1", slots.context, deps);
    expect(pick.context.state).toBe("confirmation");

    const cancel = await processSchedulerMessage("cancel", pick.context, deps);
    expect(cancel.context.intent).toBe("cancel");
    expect(cancel.context.state).toBe("booking_code_collection");
  });

  it("yes during confirmation still confirms (no false pivot)", async () => {
    const { deps } = testDeps();
    const start = await processSchedulerMessage("book an advisor call", undefined, deps);
    const topic = await processSchedulerMessage("5", start.context, deps);
    const slots = await processSchedulerMessage("Monday", topic.context, deps);
    const pick = await processSchedulerMessage("1", slots.context, deps);
    expect(pick.context.state).toBe("confirmation");

    const confirm = await processSchedulerMessage("yes", pick.context, deps);
    expect(confirm.context.state).toBe("closing");
    expect(confirm.context.booking_code).toBeTruthy();
  });

  it("no during confirmation re-offers slots (not a cancel)", async () => {
    const { deps } = testDeps();
    const start = await processSchedulerMessage("book an advisor call", undefined, deps);
    const topic = await processSchedulerMessage("5", start.context, deps);
    const slots = await processSchedulerMessage("Monday", topic.context, deps);
    const pick = await processSchedulerMessage("1", slots.context, deps);

    const no = await processSchedulerMessage("no", pick.context, deps);
    expect(no.context.intent).toBe("book_new");
    expect(["slot_selection", "offer_waitlist"]).toContain(no.context.state);
  });
});

describe("intent pivot from booking_code_collection", () => {
  it("book during cancel's booking_code_collection pivots to book_new", async () => {
    const { deps } = testDeps();
    const start = await processSchedulerMessage("cancel my appointment", undefined, deps);
    expect(start.context.intent).toBe("cancel");
    expect(start.context.state).toBe("booking_code_collection");

    const pivot = await processSchedulerMessage("Actually, I want to book a new call", start.context, deps);
    expect(pivot.context.intent).toBe("book_new");
  });
});

describe("intent pivot from offer_waitlist", () => {
  it("cancel during offer_waitlist pivots to cancel flow", async () => {
    const { deps, integrations } = testDeps();
    const start = await processSchedulerMessage("book an advisor call", undefined, deps);
    const topic = await processSchedulerMessage("1", start.context, deps);
    const ctx = { ...topic.context, state: "offer_waitlist" as const };

    const cancel = await processSchedulerMessage("cancel my booking", ctx, deps);
    expect(cancel.context.intent).toBe("cancel");
    expect(cancel.context.state).toBe("booking_code_collection");
  });
});

describe("intent pivot from cancellation_confirm", () => {
  it("book during cancellation_confirm pivots to book_new", async () => {
    const { deps } = testDeps();
    const start = await processSchedulerMessage("book an advisor call", undefined, deps);
    const topic = await processSchedulerMessage("5", start.context, deps);
    const slots = await processSchedulerMessage("Monday", topic.context, deps);
    const pick = await processSchedulerMessage("1", slots.context, deps);
    const confirm = await processSchedulerMessage("yes", pick.context, deps);
    const bookingCode = confirm.context.booking_code!;

    const cancelStart = await processSchedulerMessage("cancel my booking", confirm.context, deps);
    const cancelCode = await processSchedulerMessage(bookingCode, cancelStart.context, deps);
    expect(cancelCode.context.state).toBe("cancellation_confirm");

    const pivot = await processSchedulerMessage("Actually, book a new advisor call", cancelCode.context, deps);
    expect(pivot.context.intent).toBe("book_new");
  });
});

describe("intent pivot from closing", () => {
  it("cancel from closing re-enters intent flow", async () => {
    const { deps } = testDeps();
    const start = await processSchedulerMessage("book an advisor call", undefined, deps);
    const topic = await processSchedulerMessage("5", start.context, deps);
    const slots = await processSchedulerMessage("Monday", topic.context, deps);
    const pick = await processSchedulerMessage("1", slots.context, deps);
    const confirm = await processSchedulerMessage("yes", pick.context, deps);
    expect(confirm.context.state).toBe("closing");

    const cancel = await processSchedulerMessage("cancel my booking", confirm.context, deps);
    expect(cancel.context.intent).toBe("cancel");
    expect(["booking_code_collection", "cancellation_confirm"]).toContain(cancel.context.state);
  });

  it("reschedule from closing re-enters intent flow", async () => {
    const { deps } = testDeps();
    const start = await processSchedulerMessage("book an advisor call", undefined, deps);
    const topic = await processSchedulerMessage("5", start.context, deps);
    const slots = await processSchedulerMessage("Monday", topic.context, deps);
    const pick = await processSchedulerMessage("1", slots.context, deps);
    const confirm = await processSchedulerMessage("yes", pick.context, deps);

    const resched = await processSchedulerMessage("reschedule that", confirm.context, deps);
    expect(resched.context.intent).toBe("reschedule");
  });
});

// ─── A2: retry cap ──────────────────────────────────────────────────────────

describe("retry cap — 3 failures transitions to closing", () => {
  it("moves to closing after 3 failed intent attempts", async () => {
    const { deps } = testDeps();
    let ctx: SchedulerSessionContext | undefined;

    const r1 = await processSchedulerMessage("blah blah", ctx, deps);
    ctx = r1.context;
    expect(ctx.state).toBe("intent_classification");

    const r2 = await processSchedulerMessage("xyz", ctx, deps);
    ctx = r2.context;

    const r3 = await processSchedulerMessage("abc", ctx, deps);
    ctx = r3.context;

    const r4 = await processSchedulerMessage("qwe", ctx, deps);
    ctx = r4.context;
    expect(ctx.state).toBe("closing");
    expect(r4.response_text).toMatch(/trouble understanding/i);
  });

  it("moves to closing after 3 failed topic attempts", async () => {
    const { deps } = testDeps();
    const start = await processSchedulerMessage("book an advisor call", undefined, deps);
    expect(start.context.state).toBe("topic_collection");

    const r1 = await processSchedulerMessage("gibberish", start.context, deps);
    const r2 = await processSchedulerMessage("nonsense", r1.context, deps);
    const r3 = await processSchedulerMessage("more junk", r2.context, deps);

    const r4 = await processSchedulerMessage("still junk", r3.context, deps);
    expect(r4.context.state).toBe("closing");
  });
});

// ─── A4: weekday edge case ──────────────────────────────────────────────────

describe("weekday delta=0 returns next week", () => {
  it("'Friday' on a Friday resolves to next Friday (7 days later)", () => {
    const friday = new Date("2026-05-01T04:00:00.000Z"); // Friday in UTC
    const result = resolveDayPreference("friday", friday);
    expect(result.preferredDate).toBe("2026-05-08");
    expect(result.requestedDayLabel).toMatch(/Friday/);
  });

  it("'Monday' on a Friday still works (delta=3)", () => {
    const friday = new Date("2026-05-01T04:00:00.000Z");
    const result = resolveDayPreference("monday", friday);
    expect(result.preferredDate).toBe("2026-05-04");
  });

  it("'Sunday' on a Sunday resolves to next Sunday (7 days later)", () => {
    const sunday = new Date("2026-05-03T04:00:00.000Z");
    const result = resolveDayPreference("sunday", sunday);
    expect(result.preferredDate).toBe("2026-05-10");
  });
});

// ─── test helpers ───────────────────────────────────────────────────────────

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
