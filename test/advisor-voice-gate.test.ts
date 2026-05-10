import { describe, expect, it } from "vitest";

import {
  resolveStandaloneDeferredGreetingFlush,
  shouldDismissUnifiedAdvisorTapGate
} from "../src/lib/advisor-voice-gate";

describe("resolveStandaloneDeferredGreetingFlush", () => {
  const payload = { response_text: "Hi,\n\nI can help you book." };

  it("flushes when gate is awaiting_tap and payload has non-empty text", () => {
    const r = resolveStandaloneDeferredGreetingFlush("awaiting_tap", payload);
    expect(r).toEqual({ flush: true, greetingText: payload.response_text });
  });

  it("does not flush when gate is off", () => {
    expect(resolveStandaloneDeferredGreetingFlush("off", payload)).toEqual({ flush: false });
  });

  it("does not flush when gate is playing", () => {
    expect(resolveStandaloneDeferredGreetingFlush("playing", payload)).toEqual({ flush: false });
  });

  it("does not flush when gate is awaiting_tap_preparing (payload may be missing)", () => {
    expect(resolveStandaloneDeferredGreetingFlush("awaiting_tap_preparing", payload)).toEqual({ flush: false });
  });

  it("does not flush when gate is tap_pending_greeting_fetch (payload may arrive late)", () => {
    expect(resolveStandaloneDeferredGreetingFlush("tap_pending_greeting_fetch", payload)).toEqual({ flush: false });
  });

  it("does not flush when payload is null", () => {
    expect(resolveStandaloneDeferredGreetingFlush("awaiting_tap", null)).toEqual({ flush: false });
  });

  it("does not flush when response_text is empty or whitespace-only", () => {
    expect(resolveStandaloneDeferredGreetingFlush("awaiting_tap", { response_text: "" })).toEqual({
      flush: false
    });
    expect(resolveStandaloneDeferredGreetingFlush("awaiting_tap", { response_text: "   \n\t" })).toEqual({
      flush: false
    });
  });
});

describe("shouldDismissUnifiedAdvisorTapGate", () => {
  it("is true only for awaiting_tap", () => {
    expect(shouldDismissUnifiedAdvisorTapGate("awaiting_tap")).toBe(true);
    expect(shouldDismissUnifiedAdvisorTapGate("off")).toBe(false);
    expect(shouldDismissUnifiedAdvisorTapGate("awaiting_tap_preparing")).toBe(false);
    expect(shouldDismissUnifiedAdvisorTapGate("tap_pending_greeting_fetch")).toBe(false);
    expect(shouldDismissUnifiedAdvisorTapGate("playing")).toBe(false);
  });
});
