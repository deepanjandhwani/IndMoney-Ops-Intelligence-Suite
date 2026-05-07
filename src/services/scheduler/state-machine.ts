import { containsPii, maskPii } from "../safety/pii";
import {
  createTentativeBooking,
  requestCancellation,
  requestReschedule,
  SchedulerLifecycleDeps
} from "./booking-lifecycle";
import { formatOfferedSlots, formatSlotIST, toSlotOptions } from "./format";
import { buildSchedulerGreeting, createInitialSchedulerContext } from "./greeting";
import {
  availabilityWindowForDate,
  inferTimeWindow,
  resolveDayPreference,
  slotMatchesTimeWindow
} from "./time-preference";
import {
  buildPreparationGuidance,
  buildTopicMenu,
  classifySchedulerIntent,
  extractBookingCode,
  isNegativeWithoutCancel,
  isNo,
  isYes,
  matchTopic,
  STANDARD_ADVICE_REFUSAL
} from "./topics";
import { classifyIntentLlm } from "./llm-fallback";
import { resolveRequestedDay } from "./llm-day-resolution";
import {
  matchTopicLlm,
  selectSlotLlm,
  classifyConfirmationLlm,
  extractBookingCodeLlm
} from "./llm-step-fallbacks";
import {
  InputMode,
  SchedulerIntent,
  SchedulerOutput,
  SchedulerSessionContext,
  SchedulerState,
  SlotOption
} from "./types";

const PII_NOTICE =
  "I noticed some personal information. For your security, I've removed it. Please don't share personal details here - you'll receive a secure link to submit those after booking.";

const MAX_STATE_RETRIES = 3;

export async function getSchedulerGreeting(
  repository: SchedulerLifecycleDeps["repository"],
  inputMode: InputMode
): Promise<SchedulerOutput> {
  const pulse = await repository.getLatestReviewPulse();
  const context = createInitialSchedulerContext(inputMode);
  return {
    response_text: buildSchedulerGreeting(pulse?.top_customer_themes ?? []),
    next_state: context.state,
    context
  };
}

export async function processSchedulerMessage(
  text: string,
  context: SchedulerSessionContext | undefined,
  deps: SchedulerLifecycleDeps,
  inputMode: InputMode = context?.input_mode ?? "chat"
): Promise<SchedulerOutput> {
  const piiFound = containsPii(text);
  const maskedText = piiFound ? maskPii(text).maskedText : text;
  const current = normalizeContext(context, inputMode);
  const output = await processMaskedMessage(maskedText, current, deps);

  if (!piiFound) {
    return output;
  }

  return {
    ...output,
    pii_warning: true,
    response_text: `${PII_NOTICE}\n\n${output.response_text}`
  };
}

async function processMaskedMessage(
  text: string,
  context: SchedulerSessionContext,
  deps: SchedulerLifecycleDeps
): Promise<SchedulerOutput> {
  if (context.state === "terminal") {
    return terminal(
      "This scheduler flow is complete. Start a new message if you need another booking action.",
      context
    );
  }

  const retryableStates: SchedulerState[] = [
    "intent_classification", "topic_collection", "topic_collection_optional",
    "booking_code_collection", "slot_selection", "time_collection"
  ];
  if (retryableStates.includes(context.state) && context.retry_count >= MAX_STATE_RETRIES) {
    return respond(
      "I'm having trouble understanding. You can try again later or use the chat to type your request.",
      { ...context, state: "closing", retry_count: 0 }
    );
  }

  if (context.state === "intent_classification") {
    return handleIntent(text, context, deps);
  }

  if (isRepeatRequest(text)) {
    const repeated = repeatResponse(context);
    if (repeated) {
      return repeated;
    }
  }

  // Intent pivot runs FIRST so the user can switch intent from any state.
  const intentRouted = await trySchedulerIntentPivot(text, context, deps);
  if (intentRouted) {
    return intentRouted;
  }

  const stateScoped = await tryStateScopedTurn(text, context, deps);
  if (stateScoped) {
    return stateScoped;
  }

  switch (context.state) {
    case "topic_collection":
    case "topic_collection_optional":
      return handleTopic(text, context, deps);
    case "time_collection":
      return handleTimePreference(text, context, deps);
    case "booking_code_collection":
      return handleBookingCode(text, context, deps);
    case "slot_selection":
      return handleSlotSelection(text, context);
    case "offer_waitlist":
      return handleWaitlist(text, context, deps);
    case "confirmation":
      return handleConfirmation(text, context, deps);
    case "cancellation_confirm":
      return handleCancellationConfirm(text, context, deps);
    case "closing":
      return handleClosing(text, context, deps);
  }
}

async function handleIntent(
  text: string,
  context: SchedulerSessionContext,
  deps: SchedulerLifecycleDeps
): Promise<SchedulerOutput> {
  let intent: SchedulerIntent | "advice" | "unclear" = classifySchedulerIntent(text);

  if (intent === "advice") {
    return terminal(STANDARD_ADVICE_REFUSAL, context);
  }

  if (intent === "unclear") {
    const llmResult = await classifyIntentLlm(text);
    if (llmResult && llmResult.intent !== "unclear" && llmResult.confidence >= 0.6) {
      intent = llmResult.intent;
    } else {
      return respond(
        "Is that what you need help with, or is it something else? I can book, reschedule, cancel, check availability, or explain what to prepare.",
        { ...context, retry_count: context.retry_count + 1 }
      );
    }
  }

  if (intent === "book_new") {
    const topic = matchTopic(text);
    const time = resolveDayPreference(text, deps.now?.() ?? new Date());
    if (topic) {
      if (time.preferredDate) {
        return offerAvailability(
          {
            ...context,
            intent,
            topic,
            preferred_date: time.preferredDate,
            requested_day_label: time.requestedDayLabel,
            time_window: time.timeWindow
          },
          deps
        );
      }
      return askForTimePreference({ ...context, intent, topic, retry_count: 0 });
    }

    return respond(buildTopicMenu(), {
      ...context,
      intent,
      state: "topic_collection",
      retry_count: 0
    });
  }

  if (intent === "reschedule" || intent === "cancel") {
    return respond("Please share your booking code in the format LL-LDDD, for example NL-A742.", {
      ...context,
      intent,
      state: "booking_code_collection",
      retry_count: 0
    });
  }

  if (intent === "what_to_prepare") {
    const topic = matchTopic(text);
    if (topic) {
      return terminal(buildPreparationGuidance(topic), { ...context, intent, topic });
    }
    return respond(buildTopicMenu(true), {
      ...context,
      intent,
      state: "topic_collection_optional",
      retry_count: 0
    });
  }

  const time = resolveDayPreference(text, deps.now?.() ?? new Date());
  if (time.preferredDate) {
    return offerAvailability(
      {
        ...context,
        intent,
        preferred_date: time.preferredDate,
        requested_day_label: time.requestedDayLabel,
        time_window: time.timeWindow
      },
      deps
    );
  }

  return respond("Which day would you like me to check in IST?", {
    ...context,
    intent,
    state: "time_collection",
    retry_count: 0
  });
}

async function handleTopic(
  text: string,
  context: SchedulerSessionContext,
  deps: SchedulerLifecycleDeps
): Promise<SchedulerOutput> {
  if (context.state === "topic_collection_optional" && /\b(skip|general|anything)\b/i.test(text)) {
    return terminal(buildPreparationGuidance(), context);
  }

  let topic = matchTopic(text);
  if (!topic) {
    const llmResult = await matchTopicLlm(text);
    if (llmResult) {
      topic = llmResult.topic;
    } else {
      return respond(`I could not match that topic.\n\n${buildTopicMenu(context.state === "topic_collection_optional")}`, {
        ...context,
        retry_count: context.retry_count + 1
      });
    }
  }

  if (context.intent === "what_to_prepare") {
    return terminal(buildPreparationGuidance(topic), { ...context, topic });
  }

  if (context.selected_slot) {
    return respond(
      [
        "Please confirm your booking:",
        `  Topic: ${topic}`,
        `  Slot: ${context.selected_slot.label} (30 min)`,
        "",
        'Reply "yes" to confirm or "no" to pick a different slot.'
      ].join("\n"),
      {
        ...context,
        topic,
        intent: context.intent ?? "book_new",
        state: "confirmation",
        retry_count: 0
      }
    );
  }

  return askForTimePreference({ ...context, topic });
}

async function handleTimePreference(
  text: string,
  context: SchedulerSessionContext,
  deps: SchedulerLifecycleDeps
): Promise<SchedulerOutput> {
  const now = deps.now?.() ?? new Date();
  const resolution = resolveDayPreference(text, now);
  let timeWindow = resolution.timeWindow ?? inferTimeWindow(text) ?? context.time_window;
  let preferredDate = resolution.preferredDate;
  let requestedDayLabel = resolution.requestedDayLabel;

  if (resolution.reason === "past_date") {
    return respond(
      "That date is already in the past. Please share a day from today onward in IST.",
      {
        ...context,
        time_window: timeWindow,
        retry_count: context.retry_count + 1
      }
    );
  }

  if (!preferredDate && !context.preferred_date) {
    const llmDay = await resolveRequestedDay(text, now);
    if (llmDay?.iso_date) {
      preferredDate = llmDay.iso_date;
      requestedDayLabel = llmDay.day_label ?? undefined;
      timeWindow = llmDay.time_window ?? timeWindow;
    } else {
      return respond(
        "Please share one specific day in IST, for example Monday morning or 25 April afternoon.",
        {
          ...context,
          time_window: timeWindow,
          retry_count: context.retry_count + 1
        }
      );
    }
  }

  return offerAvailability(
    {
      ...context,
      preferred_date: preferredDate ?? context.preferred_date,
      requested_day_label: requestedDayLabel ?? context.requested_day_label,
      time_window: timeWindow
    },
    deps
  );
}

async function handleBookingCode(
  text: string,
  context: SchedulerSessionContext,
  deps: SchedulerLifecycleDeps
): Promise<SchedulerOutput> {
  let bookingCode = extractBookingCode(text);
  if (!bookingCode) {
    const llmResult = await extractBookingCodeLlm(text);
    if (llmResult) {
      bookingCode = llmResult.booking_code;
    } else {
      return respond("I could not find a valid booking code. Please use the format LL-LDDD.", {
        ...context,
        retry_count: context.retry_count + 1
      });
    }
  }

  const booking = await deps.repository.getBookingByCode(bookingCode);
  if (!booking) {
    return respond(
      `I could not find booking ${bookingCode}. Please check the code and try again.`,
      { ...context, retry_count: context.retry_count + 1 }
    );
  }

  if (context.intent === "cancel") {
    return respond(
      `I found booking ${booking.booking_code} for ${booking.topic} on ${formatSlotIST(booking.slot_start)}. Reply yes to request cancellation.`,
      {
        ...context,
        booking_code: booking.booking_code,
        state: "cancellation_confirm",
        retry_count: 0
      }
    );
  }

  return respond(buildTopicMenu(), {
    ...context,
    booking_code: booking.booking_code,
    state: "topic_collection",
    retry_count: 0
  });
}

async function handleSlotSelection(text: string, context: SchedulerSessionContext): Promise<SchedulerOutput> {
  let slot = selectSlot(text, context.slots_offered ?? []);
  if (!slot) {
    const llmResult = await selectSlotLlm(text, context.slots_offered ?? []);
    if (llmResult) {
      slot = llmResult.slot;
    } else {
      return respond("Please reply with one of the offered slot numbers, or name a different day/time in IST.", {
        ...context,
        retry_count: context.retry_count + 1
      });
    }
  }

  return respond(
    [
      "Please confirm your booking:",
      `  Topic: ${context.topic}`,
      `  Slot: ${slot.label} (30 min)`,
      "",
      'Reply "yes" to confirm or "no" to pick a different slot.'
    ].join("\n"),
    {
      ...context,
      selected_slot: slot,
      state: "confirmation",
      retry_count: 0
    }
  );
}

async function handleConfirmation(
  text: string,
  context: SchedulerSessionContext,
  deps: SchedulerLifecycleDeps
): Promise<SchedulerOutput> {
  if (isNegativeWithoutCancel(text)) {
    return offerAvailability({ ...context, selected_slot: undefined }, deps);
  }
  if (!isYes(text)) {
    const llmResult = await classifyConfirmationLlm(text);
    if (llmResult?.decision === "no") {
      return offerAvailability({ ...context, selected_slot: undefined }, deps);
    }
    if (llmResult?.decision !== "yes") {
      return respond('Please reply "yes" to confirm or "no" to pick a different slot.', context);
    }
  }
  if (!context.topic || !context.selected_slot) {
    return terminal("I lost the selected topic or slot. Please start the booking flow again.", context);
  }

  if (context.intent === "reschedule" && context.booking_code) {
    const result = await requestReschedule(
      context.booking_code,
      context.topic,
      context.selected_slot,
      deps
    );
    return respond(
      result.message + "\n\nIs there something else I can help you with?",
      { ...context, booking_code: result.booking.booking_code, state: "closing", retry_count: 0 }
    );
  }

  const result = await createTentativeBooking(
    {
      topic: context.topic,
      slot: context.selected_slot,
      inputMode: context.input_mode,
      customerId: context.customer_id
    },
    deps
  );

  const detailsInstruction = context.customer_id
    ? "[Go to My Bookings](/customer/my-bookings) to complete your details."
    : "To complete your booking, use the secure details link shown with this message.";

  const response = [
    "Your tentative booking has been created!",
    "",
    `  Booking Code: ${result.booking.booking_code}`,
    `  Topic: ${result.booking.topic}`,
    `  Slot: ${formatSlotIST(result.booking.slot_start)}`,
    "",
    "Please save your booking code. You'll need it to reschedule or cancel.",
    "",
    detailsInstruction,
    "",
    "Final customer-facing confirmation happens only after Admin approval.",
    "",
    "Is there something else I can help you with?"
  ].join("\n");

  return {
    response_text: response,
    next_state: "closing",
    context: {
      ...context,
      booking_code: result.booking.booking_code,
      state: "closing",
      last_prompt: response,
      retry_count: 0
    },
    booking_code: result.booking.booking_code,
    secure_link: context.customer_id ? undefined : result.secureLink,
    my_bookings_redirect: Boolean(context.customer_id)
  };
}

async function handleCancellationConfirm(
  text: string,
  context: SchedulerSessionContext,
  deps: SchedulerLifecycleDeps
): Promise<SchedulerOutput> {
  if (!context.booking_code) {
    return terminal("I lost the booking code. Please start the cancel flow again.", context);
  }
  if (isNo(text)) {
    return terminal(`No changes were made to booking ${context.booking_code}.`, context);
  }
  if (!isYes(text)) {
    const llmResult = await classifyConfirmationLlm(text);
    if (llmResult?.decision === "no") {
      return terminal(`No changes were made to booking ${context.booking_code}.`, context);
    }
    if (llmResult?.decision !== "yes") {
      return respond("Reply yes to continue with cancellation, or no to leave the booking unchanged.", context);
    }
  }

  const result = await requestCancellation(context.booking_code, deps);
  return respond(
    result.message + "\n\nIs there something else I can help you with?",
    { ...context, state: "closing", retry_count: 0 }
  );
}

async function offerAvailability(
  context: SchedulerSessionContext & { intent?: SchedulerIntent },
  deps: SchedulerLifecycleDeps
): Promise<SchedulerOutput> {
  if (!context.preferred_date) {
    return askForTimePreference(context);
  }

  const window = availabilityWindowForDate(context.preferred_date);
  let slots: SlotOption[];
  try {
    const availability = await deps.integrations.readAvailability({
      advisorCalendar: process.env.GOOGLE_ADVISOR_CALENDAR_ID ?? "primary",
      windowStart: window.windowStart,
      windowEnd: window.windowEnd,
      timezone: "Asia/Kolkata",
      slotDurationMinutes: 30
    });
    slots = toSlotOptions(
      availability.suggested_available_slots.filter((slot) =>
        slotMatchesTimeWindow(slot.start_time, context.time_window)
      ),
      2
    );
  } catch {
    return respond(
      [
        "I couldn't read advisor availability from Google Calendar right now.",
        context.requested_day_label
          ? `I still have ${context.requested_day_label} as your requested day.`
          : "Your requested day is still saved.",
        "Please try again in a moment, or name a different day/time in IST."
      ].join(" "),
      {
        ...context,
        state: "time_collection",
        selected_slot: undefined,
        slots_offered: undefined,
        retry_count: context.retry_count + 1
      }
    );
  }

  if (context.intent === "check_availability") {
    const text =
      slots.length > 0
        ? `${formatOfferedSlots(slots)}\n\nWould you like to book one of these slots?`
        : "I could not find available advisor slots for that preference. You can name a different day/time in IST.";
    return respond(text, {
      ...context,
      slots_offered: slots,
      state: slots.length > 0 ? "closing" : "time_collection",
      retry_count: 0
    });
  }

  if (slots.length === 0) {
    if (context.intent === "reschedule") {
      return respond(
        "I could not find alternative slots for that preference. Please try a different day or time window in IST.",
        {
          ...context,
          state: "time_collection",
          selected_slot: undefined,
          slots_offered: undefined,
          retry_count: context.retry_count + 1
        }
      );
    }

    return respond(
      "I could not find a matching advisor slot for that preference. I can add this as a waitlist request, or you can name a different day/time in IST. Reply yes to waitlist, or share another preference.",
      {
        ...context,
        state: "offer_waitlist",
        selected_slot: undefined,
        slots_offered: [],
        retry_count: 0
      }
    );
  }

  return {
    response_text: formatOfferedSlots(slots),
    next_state: "slot_selection",
    context: {
      ...context,
      slots_offered: slots,
      state: "slot_selection",
      last_prompt: formatOfferedSlots(slots),
      retry_count: 0
    },
    slots_offered: slots
  };
}

function selectSlot(text: string, slots: SlotOption[]) {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  const ordinal = ordinalSlotNumber(normalized, slots.length);
  if (ordinal) {
    return slots.find((slot) => slot.id === ordinal) ?? null;
  }

  const spokenTime = matchSlotBySpokenTime(normalized, slots);
  if (spokenTime) {
    return spokenTime;
  }

  if (normalized) {
    for (const slot of slots) {
      const label = slot.label.toLowerCase();
      if (normalized.includes(label) || label.includes(normalized)) {
        return slot;
      }
    }
  }

  const slotNumber = text.match(/\b([1-9])\b/)?.[1];
  if (!slotNumber) {
    return null;
  }
  return slots.find((slot) => slot.id === slotNumber) ?? null;
}

async function tryStateScopedTurn(
  text: string,
  context: SchedulerSessionContext,
  deps: SchedulerLifecycleDeps
): Promise<SchedulerOutput | null> {
  if (context.state === "time_collection") {
    return handleTimePreference(text, context, deps);
  }

  if (context.state === "slot_selection" && context.slots_offered?.length) {
    const slot = selectSlot(text, context.slots_offered);
    if (slot) {
      return handleSlotSelection(text, context);
    }

    const llmSlot = await selectSlotLlm(text, context.slots_offered);
    if (llmSlot) {
      return handleSlotSelection(text, context);
    }

    const correction = resolveDayPreference(text, deps.now?.() ?? new Date());
    const timeWindow = correction.timeWindow ?? inferTimeWindow(text);
    if (correction.reason === "past_date") {
      return respond(
        "That date is already in the past. Please share a day from today onward in IST.",
        {
          ...context,
          state: "time_collection",
          retry_count: context.retry_count + 1
        }
      );
    }
    if (correction.preferredDate || timeWindow) {
      return offerAvailability(
        {
          ...context,
          preferred_date: correction.preferredDate ?? context.preferred_date,
          requested_day_label: correction.requestedDayLabel ?? context.requested_day_label,
          time_window: timeWindow ?? context.time_window,
          selected_slot: undefined
        },
        deps
      );
    }
  }

  if (context.state === "confirmation") {
    if (isYes(text) || isNegativeWithoutCancel(text)) {
      return handleConfirmation(text, context, deps);
    }

    const slot = selectSlot(text, context.slots_offered ?? []);
    if (slot) {
      return respond(
        [
          "Updated. Please confirm your booking:",
          `  Topic: ${context.topic}`,
          `  Slot: ${slot.label} (30 min)`,
          "",
          'Reply "yes" to confirm or "no" to pick a different slot.'
        ].join("\n"),
        {
          ...context,
          selected_slot: slot,
          retry_count: 0
        }
      );
    }

    const correction = resolveDayPreference(text, deps.now?.() ?? new Date());
    const timeWindow = correction.timeWindow ?? inferTimeWindow(text);
    if (correction.reason === "past_date") {
      return respond(
        "That date is already in the past. Please share a day from today onward in IST.",
        {
          ...context,
          state: "time_collection",
          selected_slot: undefined,
          retry_count: context.retry_count + 1
        }
      );
    }
    if (correction.preferredDate || timeWindow) {
      return offerAvailability(
        {
          ...context,
          preferred_date: correction.preferredDate ?? context.preferred_date,
          requested_day_label: correction.requestedDayLabel ?? context.requested_day_label,
          time_window: timeWindow ?? context.time_window,
          selected_slot: undefined
        },
        deps
      );
    }
  }

  return null;
}

function askForTimePreference(context: SchedulerSessionContext): SchedulerOutput {
  const topicText = context.topic ? ` for ${context.topic}` : "";
  return respond(`Got it${topicText}. What day and time would you prefer in IST?`, {
    ...context,
    state: "time_collection",
    selected_slot: undefined,
    slots_offered: undefined,
    retry_count: 0
  });
}

async function handleWaitlist(
  text: string,
  context: SchedulerSessionContext,
  deps: SchedulerLifecycleDeps
): Promise<SchedulerOutput> {
  if (isYes(text)) {
    return respond(
      "I've kept this as a waitlist preference for now. Admin follow-up still requires the booking approval flow, so please try another day/time if you want a confirmed slot.",
      {
        ...context,
        state: "closing",
        retry_count: 0
      }
    );
  }

  const resolution = resolveDayPreference(text, deps.now?.() ?? new Date());
  if (isNo(text)) {
    return respond("No problem. Please share another day and time window in IST.", {
      ...context,
      state: "time_collection",
      retry_count: 0
    });
  }

  if (resolution.preferredDate || resolution.timeWindow) {
    return handleTimePreference(text, { ...context, state: "time_collection" }, deps);
  }

  return respond("Reply yes to keep a waitlist request, or share another day/time in IST.", {
    ...context,
    retry_count: context.retry_count + 1
  });
}

async function handleClosing(
  text: string,
  context: SchedulerSessionContext,
  deps: SchedulerLifecycleDeps
): Promise<SchedulerOutput> {
  if (context.slots_offered?.length) {
    const slot = selectSlot(text, context.slots_offered);
    const effectiveSlot = slot ?? (await selectSlotLlm(text, context.slots_offered))?.slot ?? null;
    if (effectiveSlot) {
      return transitionFromAvailabilityToBooking(effectiveSlot, context);
    }

    if (isYes(text)) {
      return respond(
        `${formatOfferedSlots(context.slots_offered)}\n\nReply with the slot number you prefer.`,
        {
          ...context,
          intent: "book_new",
          state: "slot_selection",
          retry_count: 0
        }
      );
    }
  }

  if (isNo(text)) {
    return terminal("Thank you! Feel free to come back anytime you need help.", context);
  }

  if (isYes(text)) {
    const pulse = await deps.repository.getLatestReviewPulse();
    const greeting = buildSchedulerGreeting(pulse?.top_customer_themes ?? []);
    return respond(greeting, {
      state: "intent_classification",
      input_mode: context.input_mode,
      retry_count: 0
    });
  }

  const intent = classifySchedulerIntent(text);
  if (intent !== "unclear") {
    return handleIntent(
      text,
      {
        state: "intent_classification",
        input_mode: context.input_mode,
        retry_count: 0
      },
      deps
    );
  }

  return respond(
    "I can help you book, reschedule, cancel, check availability, or explain what to prepare. Which would you like?",
    {
      ...context,
      state: "intent_classification",
      retry_count: context.retry_count + 1
    }
  );
}

function transitionFromAvailabilityToBooking(
  slot: SlotOption,
  context: SchedulerSessionContext
): SchedulerOutput {
  if (!context.topic) {
    return respond(
      `Great, I'll hold ${slot.label} for you.\n\n${buildTopicMenu()}`,
      {
        ...context,
        intent: "book_new",
        selected_slot: slot,
        state: "topic_collection",
        retry_count: 0
      }
    );
  }
  return respond(
    [
      "Please confirm your booking:",
      `  Topic: ${context.topic}`,
      `  Slot: ${slot.label} (30 min)`,
      "",
      'Reply "yes" to confirm or "no" to pick a different slot.'
    ].join("\n"),
    {
      ...context,
      intent: "book_new",
      selected_slot: slot,
      state: "confirmation",
      retry_count: 0
    }
  );
}

function isRepeatRequest(text: string) {
  return /\b(repeat|say that again|come again|what were the options|tell me again|didn'?t catch)\b/i.test(text);
}

function repeatResponse(context: SchedulerSessionContext): SchedulerOutput | null {
  if (context.state === "slot_selection" && context.slots_offered?.length) {
    return respond(`${formatOfferedSlots(context.slots_offered)}\n\nWhich one should I hold?`, context);
  }
  if (context.state === "confirmation" && context.selected_slot) {
    return respond(
      `Please confirm this IST slot: ${context.selected_slot.label}. Reply yes to proceed, or no to pick another slot.`,
      context
    );
  }
  if (context.last_prompt) {
    return respond(context.last_prompt, context);
  }
  return null;
}

function ordinalSlotNumber(text: string, slotCount: number) {
  const first = /\b(first|1st|option\s*one|slot\s*one|number\s*one|the\s*first(\s*one)?|earliest)\b/.test(text);
  const second = /\b(second|2nd|option\s*two|slot\s*two|number\s*two|the\s*second(\s*one)?|later|last)\b/.test(text);
  if (first && !second && slotCount >= 1) {
    return "1";
  }
  if (second && !first && slotCount >= 2) {
    return "2";
  }
  return null;
}

const WORD_TO_NUM: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12
};

function matchSlotBySpokenTime(text: string, slots: SlotOption[]) {
  let time = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);

  if (!time) {
    const wordMatch = text.match(new RegExp(`\\b(${Object.keys(WORD_TO_NUM).join("|")})\\s*(am|pm)?\\b`, "i"));
    if (wordMatch) {
      const num = WORD_TO_NUM[wordMatch[1].toLowerCase()];
      time = [wordMatch[0], String(num), undefined, wordMatch[2]] as unknown as RegExpMatchArray;
    }
  }

  if (!time) {
    return null;
  }

  const hour = Number(time[1]);
  const minute = Number(time[2] ?? "0");
  const ampm = time[3]?.toLowerCase();
  const possibleMinutes = new Set<number>();
  if (ampm) {
    const normalizedHour = ampm === "pm" && hour < 12 ? hour + 12 : ampm === "am" && hour === 12 ? 0 : hour;
    possibleMinutes.add(normalizedHour * 60 + minute);
  } else {
    possibleMinutes.add(hour * 60 + minute);
    if (hour <= 12) {
      possibleMinutes.add((hour + 12) * 60 + minute);
    }
  }

  const matches = slots.filter((slot) => {
    const start = new Date(slot.start_time);
    const istMinutes = (start.getUTCHours() * 60 + start.getUTCMinutes() + 330) % (24 * 60);
    return possibleMinutes.has(istMinutes);
  });

  return matches.length === 1 ? matches[0] : null;
}

/**
 * Runs after the first turn for every state except `terminal`.
 * If `classifySchedulerIntent` detects a different goal, route like `handleIntent` so parsers
 * (topic number, booking code, slot id, yes/no) never swallow a changed intent.
 */
async function trySchedulerIntentPivot(
  text: string,
  context: SchedulerSessionContext,
  deps: SchedulerLifecycleDeps
): Promise<SchedulerOutput | null> {
  const classified = classifySchedulerIntent(text);

  if (classified === "advice") {
    return terminal(STANDARD_ADVICE_REFUSAL, context);
  }

  if (classified === "unclear") {
    return null;
  }

  const sameIntent =
    classified === context.intent &&
    classified !== "what_to_prepare" &&
    classified !== "check_availability";
  if (sameIntent) {
    return null;
  }

  if (context.intent === "what_to_prepare" && classified === "what_to_prepare") {
    return null;
  }

  if (classified === "reschedule" || classified === "cancel") {
    if (context.booking_code) {
      const booking = await deps.repository.getBookingByCode(context.booking_code);
      if (!booking) {
        return respond(
          `I could not find booking ${context.booking_code}. Please check the code and try again.`,
          {
            ...context,
            booking_code: undefined,
            intent: classified,
            state: "booking_code_collection",
            topic: undefined,
            selected_slot: undefined,
            slots_offered: undefined,
            retry_count: 0
          }
        );
      }
      if (classified === "cancel") {
        return respond(
          `I found booking ${booking.booking_code} for ${booking.topic} on ${formatSlotIST(booking.slot_start)}. Reply yes to request cancellation.`,
          {
            ...context,
            intent: "cancel",
            booking_code: booking.booking_code,
            state: "cancellation_confirm",
            topic: undefined,
            selected_slot: undefined,
            slots_offered: undefined,
            retry_count: 0
          }
        );
      }
      return respond(buildTopicMenu(), {
        ...context,
        intent: "reschedule",
        booking_code: booking.booking_code,
        state: "topic_collection",
        topic: undefined,
        selected_slot: undefined,
        slots_offered: undefined,
        retry_count: 0
      });
    }
    return respond("Please share your booking code in the format LL-LDDD, for example NL-A742.", {
      ...context,
      intent: classified,
      state: "booking_code_collection",
      booking_code: undefined,
      topic: undefined,
      selected_slot: undefined,
      slots_offered: undefined,
      retry_count: 0
    });
  }

  if (classified === "book_new") {
    const topic = matchTopic(text);
    if (topic) {
      return askForTimePreference({
        ...context,
        intent: "book_new",
        booking_code: undefined,
        topic,
        preferred_date: undefined,
        requested_day_label: undefined,
        time_window: undefined,
        selected_slot: undefined,
        slots_offered: undefined,
        retry_count: 0
      });
    }

    return respond(buildTopicMenu(), {
      ...context,
      intent: "book_new",
      state: "topic_collection",
      booking_code: undefined,
      topic: undefined,
      preferred_date: undefined,
      requested_day_label: undefined,
      time_window: undefined,
      selected_slot: undefined,
      slots_offered: undefined,
      retry_count: 0
    });
  }

  if (classified === "what_to_prepare") {
    const topic = matchTopic(text);
    if (topic) {
      return terminal(buildPreparationGuidance(topic), { ...context, intent: "what_to_prepare", topic });
    }
    return respond(buildTopicMenu(true), {
      ...context,
      intent: "what_to_prepare",
      state: "topic_collection_optional",
      booking_code: undefined,
      topic: undefined,
      selected_slot: undefined,
      slots_offered: undefined,
      retry_count: 0
    });
  }

  const time = resolveDayPreference(text, deps.now?.() ?? new Date());
  if (!time.preferredDate) {
    return respond("Sure. Which day would you like me to check in IST?", {
      ...context,
      intent: "check_availability",
      state: "time_collection",
      topic: undefined,
      selected_slot: undefined,
      slots_offered: undefined,
      retry_count: 0
    });
  }

  return offerAvailability(
    {
      ...context,
      intent: "check_availability",
      preferred_date: time.preferredDate,
      requested_day_label: time.requestedDayLabel,
      time_window: time.timeWindow,
      topic: undefined,
      selected_slot: undefined,
      slots_offered: undefined,
      retry_count: 0
    },
    deps
  );
}

function normalizeContext(
  context: SchedulerSessionContext | undefined,
  inputMode: InputMode
): SchedulerSessionContext {
  return context ?? createInitialSchedulerContext(inputMode);
}

function respond(responseText: string, context: SchedulerSessionContext): SchedulerOutput {
  const nextContext = { ...context, last_prompt: responseText };
  return {
    response_text: responseText,
    next_state: nextContext.state,
    context: nextContext
  };
}

function terminal(responseText: string, context: SchedulerSessionContext): SchedulerOutput {
  const terminalContext = { ...context, state: "terminal" as const, last_prompt: responseText };
  return {
    response_text: responseText,
    next_state: "terminal",
    context: terminalContext
  };
}
