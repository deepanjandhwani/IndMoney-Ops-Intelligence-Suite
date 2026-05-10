/**
 * Pure helpers for advisor greeting / voice tap UI.
 * Used by standalone scheduler and unified assistant.
 */

/** `awaiting_tap_preparing`: tap visible, greeting/TTS fetch in flight.
 *  `tap_pending_greeting_fetch`: user tapped during prepare; show processing until fetch completes, then play.
 */
export type StandaloneAdvisorVoiceGate =
  | "off"
  | "awaiting_tap_preparing"
  | "tap_pending_greeting_fetch"
  | "awaiting_tap"
  | "playing";

export type UnifiedAdvisorVoiceGate =
  | "off"
  | "awaiting_tap_preparing"
  | "tap_pending_greeting_fetch"
  | "awaiting_tap"
  | "playing";

export type DeferredGreetingPayload = {
  response_text: string;
};

/** When true, append greeting to the thread, clear TTS stash, and set gate to off. */
export function resolveStandaloneDeferredGreetingFlush(
  gate: StandaloneAdvisorVoiceGate,
  payload: DeferredGreetingPayload | null
): { flush: false } | { flush: true; greetingText: string } {
  if (gate !== "awaiting_tap" || payload == null) {
    return { flush: false };
  }
  const greetingText = payload.response_text;
  if (!/\S/.test(greetingText)) {
    return { flush: false };
  }
  return { flush: true, greetingText };
}

/** Clear tap gate and TTS stash (no thread append — use standalone flush resolver first if needed). */
export function shouldDismissUnifiedAdvisorTapGate(gate: UnifiedAdvisorVoiceGate): boolean {
  return gate === "awaiting_tap";
}
