import { describe, expect, it } from "vitest";

import {
  assertValidReviewPulse,
  ReviewPulse,
  ReviewPulseActionIdea
} from "../src/services/reviews/review-pulse";

describe("assertValidReviewPulse", () => {
  it("accepts the Phase 2 Review Pulse structure", () => {
    expect(() => assertValidReviewPulse(validPulse())).not.toThrow();
  });

  it("requires exactly five themes", () => {
    const pulse = validPulse();
    pulse.top_themes = pulse.top_themes.slice(0, 4);

    expect(() => assertValidReviewPulse(pulse)).toThrow(
      "Review Pulse must contain exactly 5 themes."
    );
  });

  it("requires exactly three overall representative quotes", () => {
    const pulse = validPulse();
    pulse.representative_quotes = ["Only one quote"];

    expect(() => assertValidReviewPulse(pulse)).toThrow(
      "Review Pulse must contain exactly 3 representative quotes."
    );
  });

  it("requires substantive representative quotes", () => {
    const pulse = validPulse();
    pulse.representative_quotes[0] = "good";

    expect(() => assertValidReviewPulse(pulse)).toThrow(
      "Review Pulse representative quote at index 0 must be substantive."
    );
  });

  it("requires exactly three structured action ideas", () => {
    const pulse = validPulse();
    pulse.action_ideas = [idea("Only one theme tied.", "T", "Quote.")];

    expect(() => assertValidReviewPulse(pulse)).toThrow(
      "Review Pulse must contain exactly 3 action ideas."
    );
  });

  it("requires non-empty evidence strings on action ideas", () => {
    const pulse = validPulse();
    pulse.action_ideas[0] = idea("Has idea.", "Theme", "");

    expect(() => assertValidReviewPulse(pulse)).toThrow(
      "Review Pulse action idea at index 0 must include idea, based_on_theme, and evidence."
    );
  });
});

function validPulse(): ReviewPulse {
  return {
    product: "Groww",
    period: "Rolling 12 weeks ending 2026-04-30",
    total_reviews_analyzed: 180,
    average_rating: 3.2,
    top_themes: [
      theme("Nominee Updates", 1),
      theme("Login Issues", 2),
      theme("Statement Downloads", 3),
      theme("SIP / Mandate Issues", 4),
      theme("App Performance", 5)
    ],
    representative_quotes: [
      "Nominee update flow keeps failing during verification.",
      "Login gets stuck after OTP and dashboard remains blank.",
      "Statement download fails repeatedly even after payment."
    ],
    weekly_summary: "Review themes show recurring customer friction.",
    action_ideas: [
      idea(
        "Improve status messaging.",
        "Nominee Updates",
        'Customer: "quote 1"; similar themes in nominee flow.'
      ),
      idea(
        "Clarify OTP errors.",
        "Login Issues",
        'Representative quote: "quote 1" from login cluster.'
      ),
      idea(
        "Surface help links.",
        "Statement Downloads",
        'Evidence from quotes such as "quote 1".'
      )
    ],
    top_customer_themes: ["Nominee Updates", "Login Issues", "Statement Downloads"],
    source: "Google Play Store Reviews"
  };
}

function theme(themeName: string, rank: number) {
  return { theme: themeName, rank };
}

function idea(
  ideaText: string,
  basedOn: string,
  evidence: string
): ReviewPulseActionIdea {
  return { idea: ideaText, based_on_theme: basedOn, evidence };
}
