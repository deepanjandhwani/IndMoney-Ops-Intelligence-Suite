import { describe, expect, it } from "vitest";

import {
  classifyReviewTextQuality,
  hasActionableKeyword,
  passesLanguageHeuristic,
  passesLowInformationGate
} from "../src/services/reviews/review-quality";

describe("review-quality gates", () => {
  it("passes fluent English with enough tokens", () => {
    const text =
      "The nominee update flow is confusing and I cannot finish verification without errors.";
    expect(passesLowInformationGate(text)).toBe(true);
    expect(passesLanguageHeuristic(text)).toBe(true);
    expect(classifyReviewTextQuality(text)).toEqual({ ok: true });
  });

  it("passes Hinglish written in Latin script", () => {
    const text =
      "Yaar ye app bahut hang ho rahi hai login karne ke baad dashboard blank aa jata hai.";
    expect(passesLowInformationGate(text)).toBe(true);
    expect(passesLanguageHeuristic(text)).toBe(true);
    expect(classifyReviewTextQuality(text)).toEqual({ ok: true });
  });

  it("rejects emoji-only feedback", () => {
    const text = "⭐⭐⭐ 🔥🔥 👍👍👍";
    expect(passesLowInformationGate(text)).toBe(false);
    expect(classifyReviewTextQuality(text)).toMatchObject({
      ok: false,
      reason: "low_information"
    });
  });

  it("allows short reviews when actionable keywords appear", () => {
    expect(hasActionableKeyword("login broken")).toBe(true);
    expect(passesLowInformationGate("login broken")).toBe(true);
    expect(classifyReviewTextQuality("login broken")).toEqual({ ok: true });
  });

  it("skips long Hindi-script-only reviews without Latin operational hints", () => {
    const text =
      "यह एप्लिकेशन बिल्कुल भी अच्छा नहीं है और सेवा बहुत धीमी है खराब अनुभव हुआ है लगातार समस्या आ रही है।";
    expect(passesLowInformationGate(text)).toBe(true);
    expect(passesLanguageHeuristic(text)).toBe(false);
    expect(classifyReviewTextQuality(text)).toMatchObject({
      ok: false,
      reason: "unsupported_language"
    });
  });

  it("keeps Hindi-heavy reviews when Latin keywords appear", () => {
    const text =
      "लॉगिन करने में समस्या है और withdraw भी pending दिख रहा है बहुत परेशान हूँ लगातार कोशिश कर रहा हूँ।";
    expect(hasActionableKeyword(text)).toBe(true);
    expect(classifyReviewTextQuality(text)).toEqual({ ok: true });
  });
});
