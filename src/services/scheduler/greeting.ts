import { InputMode, SchedulerSessionContext } from "./types";

const INTENT_LIST =
  "I can help you **book** a new session, **reschedule** or **cancel** an existing one, " +
  "**check availability**, or **explain what to prepare** for your call.";

export function buildSchedulerGreeting(themes: string[], customerName?: string) {
  const disclaimer = "This is for informational support only, not investment advice.";
  const hi = customerName ? `Hi ${customerName},` : "Hi,";

  if (themes.length === 0) {
    return (
      `${hi} I can help you book or manage a tentative advisor slot. ${disclaimer}\n\n` +
      `${INTENT_LIST}\n\nWhat would you like to do?`
    );
  }

  const themeList = themes.slice(0, 3).join(" and ");
  return (
    `${hi} I can help you book or manage a tentative advisor slot. ${disclaimer}\n\n` +
    `I also see many users are currently asking about ${themeList}.\n\n` +
    `${INTENT_LIST}\n\nWhat would you like to do?`
  );
}

export function createInitialSchedulerContext(inputMode: InputMode): SchedulerSessionContext {
  return {
    state: "intent_classification",
    input_mode: inputMode,
    retry_count: 0
  };
}
