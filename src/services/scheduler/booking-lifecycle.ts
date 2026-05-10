import { generateUniqueBookingCode } from "./booking-code";
import { formatSlotIST } from "./format";
import { SchedulerIntegrations } from "./integrations";
import { SchedulerRepository } from "./repository";
import {
  BookingRecord,
  BookingStatus,
  HitlActionRecord,
  InputMode,
  SchedulerTopic,
  SlotOption
} from "./types";
import {
  createSecureDetailsToken,
  decryptSecureDetails,
  encryptSecureDetails,
  hashSecureDetailsToken,
  secureDetailsExpiry,
  SecureDetailsPayload
} from "./secure-details";

export type SchedulerLifecycleDeps = {
  repository: SchedulerRepository;
  integrations: SchedulerIntegrations;
  appUrl?: string;
  now?: () => Date;
};

export type CreateTentativeBookingInput = {
  topic: SchedulerTopic;
  slot: SlotOption;
  inputMode: InputMode;
  customerId?: string;
};

export type CreateTentativeBookingResult = {
  booking: BookingRecord;
  hitlAction: HitlActionRecord;
  secureLink: string;
};

export async function createTentativeBooking(
  input: CreateTentativeBookingInput,
  deps: SchedulerLifecycleDeps
): Promise<CreateTentativeBookingResult> {
  const bookingCode = await generateUniqueBookingCode(deps.repository);
  const token = createSecureDetailsToken();
  const expiresAt = secureDetailsExpiry(deps.now?.() ?? new Date());
  let booking = await deps.repository.createBooking({
    booking_code: bookingCode,
    topic: input.topic,
    slot_start: input.slot.start_time,
    slot_end: input.slot.end_time,
    input_mode: input.inputMode,
    secure_details_token_hash: token.tokenHash,
    secure_link_expires_at: expiresAt,
    customer_id: input.customerId
  });

  const pulse = await deps.repository.getLatestReviewPulse();
  const partialFailures: Record<string, string> = {};

  try {
    const calendar = await deps.integrations.createCalendarHold({
      title: calendarTitle(booking),
      startTime: booking.slot_start,
      endTime: booking.slot_end,
      timezone: "Asia/Kolkata",
      bookingCode: booking.booking_code,
      description: calendarDescription(booking)
    });
    booking = await deps.repository.updateBooking(booking.id, {
      calendar_event_id: calendar.event_id,
      calendar_status: "created"
    });
  } catch (error) {
    partialFailures.calendar_error = errorMessage(error);
    booking = await deps.repository.updateBooking(booking.id, { calendar_status: "failed" });
  }

  try {
    const sheet = await deps.integrations.appendSheetRow(
      buildSheetRow(booking, pulse?.top_customer_themes ?? [])
    );
    booking = await deps.repository.updateBooking(booking.id, {
      sheet_row_id: sheet.updated_range ?? sheet.spreadsheet_url ?? null,
      sheet_status: "created"
    });
  } catch (error) {
    partialFailures.sheet_error = errorMessage(error);
    booking = await deps.repository.updateBooking(booking.id, { sheet_status: "failed" });
  }

  try {
    const draft = await deps.integrations.createAdvisorEmailDraft({
      subject: emailSubject("Advisor Pre-Booking", booking),
      body: buildAdvisorEmailBody(booking, marketContext(pulse))
    });
    booking = await deps.repository.updateBooking(booking.id, {
      email_draft_id: draft.draft_id,
      email_draft_status: "created"
    });
  } catch (error) {
    partialFailures.email_error = errorMessage(error);
    booking = await deps.repository.updateBooking(booking.id, { email_draft_status: "failed" });
  }

  const hitlAction = await deps.repository.createHitlAction({
    booking_id: booking.id,
    booking_code: booking.booking_code,
    action_type: "confirm",
    target_booking_status: "confirmed",
    payload: buildHitlPayload(booking, { partialFailures }),
    calendar_status: booking.calendar_status,
    sheet_status: booking.sheet_status,
    email_draft_status: booking.email_draft_status
  });

  return {
    booking,
    hitlAction,
    secureLink: secureDetailsUrl(token.token, deps.appUrl)
  };
}

export async function requestReschedule(
  bookingCode: string,
  topic: SchedulerTopic,
  slot: SlotOption,
  deps: SchedulerLifecycleDeps
) {
  const booking = await requireBooking(bookingCode, deps.repository);
  if (booking.status === "cancelled") {
    return { booking, message: `Booking ${booking.booking_code} is already cancelled.` };
  }
  if (booking.status === "pending_admin_confirmation") {
    return rescheduleBeforeConfirmation(booking, topic, slot, deps);
  }
  if (booking.status === "confirmed" || booking.status === "rescheduled") {
    return requestPostConfirmationReschedule(booking, topic, slot, deps);
  }

  return {
    booking,
    message: `Booking ${booking.booking_code} is currently ${booking.status}; it cannot be rescheduled from chat.`
  };
}

export async function requestCancellation(bookingCode: string, deps: SchedulerLifecycleDeps) {
  const booking = await requireBooking(bookingCode, deps.repository);
  if (booking.status === "cancelled") {
    return { booking, message: `Booking ${booking.booking_code} is already cancelled.` };
  }
  if (booking.status === "pending_admin_confirmation") {
    return cancelBeforeConfirmation(booking, deps);
  }
  if (booking.status === "confirmed" || booking.status === "rescheduled") {
    const updated = await transitionBookingAndSheet(booking, "cancel_requested", deps);
    const hitlAction = await deps.repository.createHitlAction({
      booking_id: updated.id,
      booking_code: updated.booking_code,
      action_type: "cancel",
      target_booking_status: "cancelled",
      payload: buildHitlPayload(updated, {
        previous_status: booking.status,
        requested_status: "cancel_requested"
      }),
      calendar_status: updated.calendar_status,
      sheet_status: updated.sheet_status,
      email_draft_status: updated.email_draft_status
    });
    return {
      booking: updated,
      hitlAction,
      message: `Cancellation request for ${updated.booking_code} is queued for Admin approval.`
    };
  }

  return {
    booking,
    message: `Booking ${booking.booking_code} is currently ${booking.status}; it cannot be cancelled from chat.`
  };
}

export async function decideHitlAction(
  hitlActionId: string,
  decision: "approve" | "reject",
  deps: SchedulerLifecycleDeps,
  adminNotes?: string
) {
  const action = await deps.repository.getHitlAction(hitlActionId);
  if (!action) {
    throw new Error(`HITL action not found: ${hitlActionId}`);
  }
  const booking = await requireBooking(action.booking_code, deps.repository);

  if (decision === "reject") {
    const rejectedStatus = action.action_type === "confirm" ? "rejected" : previousStatus(action);
    const updated = await transitionBookingAndSheet(booking, rejectedStatus, deps);
    const hitlAction = await deps.repository.updateHitlAction(action.id, {
      status: "rejected",
      admin_notes: adminNotes ?? null,
      payload: { ...action.payload, decision: "reject", final_booking_status: updated.status },
      sheet_status: updated.sheet_status
    });
    return { booking: updated, hitlAction };
  }

  if (action.action_type === "confirm") {
    let recovered = await recoverFailedIntegrations(booking, deps);
    recovered = await transitionBookingAndSheet(recovered, "confirmed", deps);
    const hitlAction = await deps.repository.updateHitlAction(action.id, {
      status: "executed",
      admin_notes: adminNotes ?? null,
      calendar_status: recovered.calendar_status,
      sheet_status: recovered.sheet_status,
      email_draft_status: recovered.email_draft_status,
      payload: {
        ...action.payload,
        decision: "approve"
      }
    });
    return { booking: recovered, hitlAction };
  }

  if (action.action_type === "reschedule") {
    return approveReschedule(action, booking, deps, adminNotes);
  }

  if (action.action_type === "cancel") {
    return approveCancellation(action, booking, deps, adminNotes);
  }

  throw new Error(`Unsupported HITL action type: ${action.action_type}`);
}

export async function addCustomerToCalendar(
  bookingCode: string,
  deps: SchedulerLifecycleDeps
) {
  const booking = await requireBooking(bookingCode, deps.repository);
  if (!booking.secure_link_submitted) {
    throw new Error("Customer has not submitted secure details yet.");
  }
  if (!booking.calendar_event_id) {
    throw new Error("No calendar event exists for this booking.");
  }
  if (booking.status !== "confirmed" && booking.status !== "rescheduled") {
    throw new Error(`Booking is ${booking.status}; attendee can only be added after approval.`);
  }

  const result = await maybeAddCustomerAttendee(booking, deps);
  if (result.status === "failed") {
    throw new Error(result.error ?? "Failed to add customer attendee.");
  }

  const hitl = await deps.repository.getLatestHitlActionForBooking(booking.id);
  if (hitl) {
    await deps.repository.updateHitlAction(hitl.id, {
      calendar_status: result.booking.calendar_status,
      payload: { ...hitl.payload, customer_attendee_added: result.added }
    });
  }

  return result;
}

export async function submitSecureDetails(
  token: string,
  details: SecureDetailsPayload,
  deps: SchedulerLifecycleDeps
) {
  const tokenHash = hashSecureDetailsToken(token);
  const booking = await deps.repository.getBookingBySecureTokenHash(tokenHash);
  if (!booking) {
    throw new Error("Secure details link is invalid or expired.");
  }
  const now = deps.now?.() ?? new Date();
  if (!booking.secure_link_expires_at || new Date(booking.secure_link_expires_at) < now) {
    throw new Error("Secure details link has expired.");
  }

  await deps.repository.storeSecureDetails({
    booking_id: booking.id,
    booking_code: booking.booking_code,
    token_hash: tokenHash,
    details_ciphertext: encryptSecureDetails(details),
    expires_at: booking.secure_link_expires_at
  });
  const updated = await deps.repository.updateBooking(booking.id, {
    secure_link_submitted: true
  });

  let afterDraft = updated;
  try {
    const draft = await deps.integrations.createAdvisorEmailDraft({
      to: details.customer_email,
      subject: emailSubject("Booking Confirmation", updated),
      body: buildCustomerEmailBody(updated)
    });
    afterDraft = await deps.repository.updateBooking(updated.id, {
      customer_email_draft_id: draft.draft_id,
      customer_email_draft_status: "created"
    });
  } catch {
    afterDraft = await deps.repository.updateBooking(updated.id, {
      customer_email_draft_status: "failed"
    });
  }

  const pendingHitl = await deps.repository.getLatestHitlActionForBooking(afterDraft.id);
  if (pendingHitl && pendingHitl.status === "pending") {
    await deps.repository.updateHitlAction(pendingHitl.id, {
      payload: { ...pendingHitl.payload, secure_link_submitted: true }
    });
  }

  if (afterDraft.status === "confirmed" || afterDraft.status === "rescheduled") {
    return maybeAddCustomerAttendee(afterDraft, deps);
  }

  return { booking: afterDraft, added: false as const, status: "pending" as const };
}

async function rescheduleBeforeConfirmation(
  booking: BookingRecord,
  topic: SchedulerTopic,
  slot: SlotOption,
  deps: SchedulerLifecycleDeps
) {
  let updated = await deps.repository.updateBooking(booking.id, {
    topic,
    slot_start: slot.start_time,
    slot_end: slot.end_time,
    status: "pending_admin_confirmation"
  });
  const partialFailures: Record<string, string> = {};

  if (updated.calendar_event_id) {
    try {
      await deps.integrations.updateCalendarEvent({
        eventId: updated.calendar_event_id,
        title: calendarTitle(updated),
        startTime: updated.slot_start,
        endTime: updated.slot_end,
        description: calendarDescription(updated)
      });
      updated = await deps.repository.updateBooking(updated.id, { calendar_status: "updated" });
    } catch (error) {
      partialFailures.calendar_error = errorMessage(error);
      updated = await deps.repository.updateBooking(updated.id, { calendar_status: "failed" });
    }
  }

  updated = await syncSheet(updated, deps, {
    approval_status: updated.status,
    slot: formatSlotIST(updated.slot_start),
    topic: updated.topic
  });
  updated = await createUpdatedDraft(updated, deps, partialFailures);
  await updateLatestHitlPayload(updated, deps, partialFailures);

  return {
    booking: updated,
    message: `Booking ${updated.booking_code} was updated to ${formatSlotIST(updated.slot_start)} and remains pending Admin confirmation.`
  };
}

async function requestPostConfirmationReschedule(
  booking: BookingRecord,
  topic: SchedulerTopic,
  slot: SlotOption,
  deps: SchedulerLifecycleDeps
) {
  const updated = await transitionBookingAndSheet(booking, "reschedule_requested", deps);
  const hitlAction = await deps.repository.createHitlAction({
    booking_id: updated.id,
    booking_code: updated.booking_code,
    action_type: "reschedule",
    target_booking_status: "rescheduled",
    payload: buildHitlPayload(updated, {
      previous_status: booking.status,
      proposed_topic: topic,
      proposed_slot_start: slot.start_time,
      proposed_slot_end: slot.end_time,
      proposed_slot_label: slot.label
    }),
    calendar_status: updated.calendar_status,
    sheet_status: updated.sheet_status,
    email_draft_status: updated.email_draft_status
  });
  return {
    booking: updated,
    hitlAction,
    message: `Reschedule request for ${updated.booking_code} is queued for Admin approval.`
  };
}

async function cancelBeforeConfirmation(booking: BookingRecord, deps: SchedulerLifecycleDeps) {
  let updated = await deps.repository.updateBooking(booking.id, { status: "cancelled" });
  if (updated.calendar_event_id) {
    try {
      await deps.integrations.cancelCalendarEvent({ eventId: updated.calendar_event_id });
      updated = await deps.repository.updateBooking(updated.id, { calendar_status: "cancelled" });
    } catch {
      updated = await deps.repository.updateBooking(updated.id, { calendar_status: "failed" });
    }
  }
  updated = await syncSheet(updated, deps, { approval_status: "cancelled" });
  const hitl = await deps.repository.getLatestHitlActionForBooking(updated.id, "confirm");
  if (hitl) {
    await deps.repository.updateHitlAction(hitl.id, {
      status: "executed",
      target_booking_status: "cancelled",
      sheet_status: updated.sheet_status,
      calendar_status: updated.calendar_status,
      payload: { ...hitl.payload, final_booking_status: "cancelled" }
    });
  }
  return {
    booking: updated,
    message: `Booking ${updated.booking_code} has been cancelled.`
  };
}

async function approveReschedule(
  action: HitlActionRecord,
  booking: BookingRecord,
  deps: SchedulerLifecycleDeps,
  adminNotes?: string
) {
  const slotStart = String(action.payload.proposed_slot_start ?? "");
  const slotEnd = String(action.payload.proposed_slot_end ?? "");
  const topic = action.payload.proposed_topic as SchedulerTopic | undefined;
  if (!slotStart || !slotEnd || !topic) {
    throw new Error("Missing proposed reschedule payload.");
  }

  let updated = await deps.repository.updateBooking(booking.id, {
    topic,
    slot_start: slotStart,
    slot_end: slotEnd,
    status: "rescheduled"
  });
  const partialFailures: Record<string, string> = {};

  if (updated.calendar_event_id) {
    try {
      await deps.integrations.updateCalendarEvent({
        eventId: updated.calendar_event_id,
        title: calendarTitle(updated),
        startTime: updated.slot_start,
        endTime: updated.slot_end,
        description: calendarDescription(updated)
      });
      updated = await deps.repository.updateBooking(updated.id, { calendar_status: "updated" });
    } catch (error) {
      partialFailures.calendar_error = errorMessage(error);
      updated = await deps.repository.updateBooking(updated.id, { calendar_status: "failed" });
    }
  }

  updated = await syncSheet(updated, deps, {
    approval_status: "rescheduled",
    slot: formatSlotIST(updated.slot_start),
    topic: updated.topic
  });
  updated = await createUpdatedDraft(updated, deps, partialFailures);

  const hitlAction = await deps.repository.updateHitlAction(action.id, {
    status: Object.keys(partialFailures).length > 0 ? "failed" : "executed",
    admin_notes: adminNotes ?? null,
    calendar_status: updated.calendar_status,
    sheet_status: updated.sheet_status,
    email_draft_status: updated.email_draft_status,
    payload: {
      ...action.payload,
      decision: "approve",
      partial_failures: partialFailures
    }
  });

  return { booking: updated, hitlAction };
}

async function approveCancellation(
  action: HitlActionRecord,
  booking: BookingRecord,
  deps: SchedulerLifecycleDeps,
  adminNotes?: string
) {
  let updated = await deps.repository.updateBooking(booking.id, { status: "cancelled" });
  const partialFailures: Record<string, string> = {};

  if (updated.calendar_event_id) {
    try {
      await deps.integrations.cancelCalendarEvent({ eventId: updated.calendar_event_id });
      updated = await deps.repository.updateBooking(updated.id, { calendar_status: "cancelled" });
    } catch (error) {
      partialFailures.calendar_error = errorMessage(error);
      updated = await deps.repository.updateBooking(updated.id, { calendar_status: "failed" });
    }
  }

  updated = await syncSheet(updated, deps, { approval_status: "cancelled" });
  const hitlAction = await deps.repository.updateHitlAction(action.id, {
    status: Object.keys(partialFailures).length > 0 ? "failed" : "executed",
    admin_notes: adminNotes ?? null,
    calendar_status: updated.calendar_status,
    sheet_status: updated.sheet_status,
    payload: { ...action.payload, decision: "approve", partial_failures: partialFailures }
  });

  return { booking: updated, hitlAction };
}

async function maybeAddCustomerAttendee(booking: BookingRecord, deps: SchedulerLifecycleDeps) {
  if (!booking.secure_link_submitted || !booking.calendar_event_id) {
    return { booking, added: false as const, status: "pending" as const };
  }

  const submission = await deps.repository.getSecureDetailsForBooking(booking.id);
  if (!submission) {
    return { booking, added: false as const, status: "pending" as const };
  }

  try {
    const details = decryptSecureDetails(submission.details_ciphertext);
    await deps.integrations.addCustomerAttendee({
      eventId: booking.calendar_event_id,
      customerEmail: details.customer_email,
      customerName: details.customer_name
    });
    const updated = await deps.repository.updateBooking(booking.id, { calendar_status: "updated" });
    return { booking: updated, added: true as const, status: "updated" as const };
  } catch (error) {
    const updated = await deps.repository.updateBooking(booking.id, { calendar_status: "failed" });
    return {
      booking: updated,
      added: false as const,
      status: "failed" as const,
      error: errorMessage(error)
    };
  }
}

async function recoverFailedIntegrations(
  booking: BookingRecord,
  deps: SchedulerLifecycleDeps
): Promise<BookingRecord> {
  let current = booking;

  if (current.calendar_status === "failed" || current.calendar_status === "pending") {
    try {
      const calendar = await deps.integrations.createCalendarHold({
        title: calendarTitle(current),
        startTime: current.slot_start,
        endTime: current.slot_end,
        timezone: "Asia/Kolkata",
        bookingCode: current.booking_code,
        description: calendarDescription(current)
      });
      current = await deps.repository.updateBooking(current.id, {
        calendar_event_id: calendar.event_id,
        calendar_status: "created"
      });
    } catch {
      current = await deps.repository.updateBooking(current.id, { calendar_status: "failed" });
    }
  }

  if (current.sheet_status === "failed" || current.sheet_status === "pending") {
    try {
      const pulse = await deps.repository.getLatestReviewPulse();
      await deps.integrations.appendSheetRow(
        buildSheetRow(current, pulse?.top_customer_themes ?? [])
      );
      current = await deps.repository.updateBooking(current.id, { sheet_status: "created" });
    } catch {
      current = await deps.repository.updateBooking(current.id, { sheet_status: "failed" });
    }
  }

  if (current.email_draft_status === "failed" || current.email_draft_status === "pending") {
    try {
      const pulse = await deps.repository.getLatestReviewPulse();
      const draft = await deps.integrations.createAdvisorEmailDraft({
        subject: emailSubject("Advisor Pre-Booking", current),
        body: buildAdvisorEmailBody(current, marketContext(pulse))
      });
      current = await deps.repository.updateBooking(current.id, {
        email_draft_id: draft.draft_id,
        email_draft_status: "created"
      });
    } catch {
      current = await deps.repository.updateBooking(current.id, { email_draft_status: "failed" });
    }
  }

  return current;
}

async function transitionBookingAndSheet(
  booking: BookingRecord,
  status: BookingStatus,
  deps: SchedulerLifecycleDeps
) {
  const updated = await deps.repository.updateBooking(booking.id, { status });
  return syncSheet(updated, deps, { approval_status: status });
}

async function syncSheet(
  booking: BookingRecord,
  deps: SchedulerLifecycleDeps,
  updates: Parameters<SchedulerIntegrations["updateSheetRowByBookingCode"]>[1]
) {
  try {
    const result = await deps.integrations.updateSheetRowByBookingCode(booking.booking_code, updates);
    if (result.status === "not_found") {
      const pulse = await deps.repository.getLatestReviewPulse();
      await deps.integrations.appendSheetRow(
        buildSheetRow(
          { ...booking, status: (updates.approval_status as BookingStatus) ?? booking.status },
          pulse?.top_customer_themes ?? []
        )
      );
      return deps.repository.updateBooking(booking.id, { sheet_status: "created" });
    }
    return deps.repository.updateBooking(booking.id, {
      sheet_status: result.status === "updated" ? "updated" : "failed"
    });
  } catch {
    return deps.repository.updateBooking(booking.id, { sheet_status: "failed" });
  }
}

async function createUpdatedDraft(
  booking: BookingRecord,
  deps: SchedulerLifecycleDeps,
  partialFailures: Record<string, string>
) {
  try {
    const pulse = await deps.repository.getLatestReviewPulse();
    const draft = await deps.integrations.createAdvisorEmailDraft({
      subject: emailSubject("Advisor Booking Update", booking),
      body: buildAdvisorEmailBody(booking, marketContext(pulse))
    });
    return deps.repository.updateBooking(booking.id, {
      email_draft_id: draft.draft_id,
      email_draft_status: "updated"
    });
  } catch (error) {
    partialFailures.email_error = errorMessage(error);
    return deps.repository.updateBooking(booking.id, { email_draft_status: "failed" });
  }
}

async function updateLatestHitlPayload(
  booking: BookingRecord,
  deps: SchedulerLifecycleDeps,
  partialFailures: Record<string, string>
) {
  const hitl = await deps.repository.getLatestHitlActionForBooking(booking.id, "confirm");
  if (!hitl) {
    return;
  }
  await deps.repository.updateHitlAction(hitl.id, {
    payload: buildHitlPayload(booking, { partialFailures }),
    calendar_status: booking.calendar_status,
    sheet_status: booking.sheet_status,
    email_draft_status: booking.email_draft_status
  });
}

async function requireBooking(bookingCode: string, repository: SchedulerRepository) {
  const booking = await repository.getBookingByCode(bookingCode);
  if (!booking) {
    throw new Error(`Booking code not found: ${bookingCode}`);
  }
  return booking;
}

function buildSheetRow(booking: BookingRecord, themes: string[]) {
  return {
    date: new Date(booking.created_at ?? Date.now()).toISOString().slice(0, 10),
    product: "Groww",
    topic: booking.topic,
    slot: formatSlotIST(booking.slot_start),
    booking_code: booking.booking_code,
    weekly_pulse_themes: themes,
    source: "Advisor Scheduler",
    approval_status: booking.status,
    advisor_calendar_status: booking.calendar_status,
    advisor_email_draft_status: booking.email_draft_status
  };
}

function buildCustomerEmailBody(booking: BookingRecord) {
  return [
    "Thank you for scheduling an advisor session with Groww.",
    "",
    `Booking Code: ${booking.booking_code}`,
    `Topic: ${booking.topic}`,
    `Slot: ${formatSlotIST(booking.slot_start)}`,
    "",
    "Your booking is pending admin confirmation. You will receive a",
    "calendar invite once the advisor team approves.",
    "",
    "Please keep your booking code handy for any changes."
  ].join("\n");
}

function buildAdvisorEmailBody(booking: BookingRecord, context: string) {
  return [
    "A tentative advisor booking has been created.",
    "",
    "Product: Groww",
    `Booking Code: ${booking.booking_code}`,
    `Topic: ${booking.topic}`,
    `Slot: ${formatSlotIST(booking.slot_start)}`,
    "",
    "No PII was collected during the AI scheduler flow. The customer will",
    "complete personal details through the secure link.",
    "",
    "Market/Product Context:",
    context,
    "",
    "Please review before the meeting."
  ].join("\n");
}

function buildHitlPayload(
  booking: BookingRecord,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  const partialFailures = extra.partialFailures as Record<string, string> | undefined;
  return {
    booking_code: booking.booking_code,
    product: booking.product,
    topic: booking.topic,
    slot_start: booking.slot_start,
    slot_end: booking.slot_end,
    slot_label: formatSlotIST(booking.slot_start),
    status: booking.status,
    calendar_status: booking.calendar_status,
    sheet_status: booking.sheet_status,
    email_draft_status: booking.email_draft_status,
    secure_link_submitted: booking.secure_link_submitted,
    ...(partialFailures && Object.keys(partialFailures).length > 0
      ? { partial_failures: partialFailures }
      : {}),
    ...extra
  };
}

function previousStatus(action: HitlActionRecord): BookingStatus {
  return (action.payload.previous_status as BookingStatus | undefined) ?? "confirmed";
}

function marketContext(pulse: Awaited<ReturnType<SchedulerRepository["getLatestReviewPulse"]>>) {
  if (!pulse) {
    return "No recent review pulse data available.";
  }
  const themes = pulse.top_customer_themes.length > 0 ? pulse.top_customer_themes.join(", ") : "N/A";
  return `This week's review pulse shows ${themes} as the top recurring themes. ${pulse.weekly_summary}`;
}

function calendarTitle(booking: BookingRecord) {
  return `Advisor Q&A - ${booking.topic} - ${booking.booking_code}`;
}

function calendarDescription(booking: BookingRecord) {
  return `Booking Code: ${booking.booking_code}\nNo customer attendee until secure details and Admin approval.`;
}

function emailSubject(prefix: string, booking: BookingRecord) {
  return `${prefix} - ${booking.topic} - ${booking.booking_code}`;
}

function secureDetailsUrl(token: string, appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "") {
  const baseUrl = appUrl.trim().replace(/\/$/, "");
  return `${baseUrl || ""}/secure-details/${token}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
