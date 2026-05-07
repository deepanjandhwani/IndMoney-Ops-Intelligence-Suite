export type ReviewPulseTheme = {
  theme: string;
  rank: number;
};

/** Structured pulse actions grounded in themes and overall quoted evidence */
export type ReviewPulseActionIdea = {
  idea: string;
  based_on_theme: string;
  evidence: string;
};

export type ReviewPulse = {
  product: "Groww";
  period: string;
  total_reviews_analyzed: number;
  average_rating: number;
  top_themes: ReviewPulseTheme[];
  representative_quotes: string[];
  weekly_summary: string;
  action_ideas: ReviewPulseActionIdea[];
  top_customer_themes: string[];
  source: "Google Play Store Reviews";
};

export function assertValidReviewPulse(pulse: ReviewPulse) {
  if (pulse.product !== "Groww") {
    throw new Error("Review Pulse product must be Groww.");
  }

  if (pulse.source !== "Google Play Store Reviews") {
    throw new Error("Review Pulse source must be Google Play Store Reviews.");
  }

  if (pulse.top_themes.length !== 5) {
    throw new Error("Review Pulse must contain exactly 5 themes.");
  }

  pulse.top_themes.forEach((theme, index) => {
    const rank = index + 1;
    if (theme.rank !== rank) {
      throw new Error(`Review Pulse theme at index ${index} must have rank ${rank}.`);
    }
  });

  if (pulse.representative_quotes.length !== 3) {
    throw new Error("Review Pulse must contain exactly 3 representative quotes.");
  }

  pulse.representative_quotes.forEach((quote, index) => {
    if (quote.trim().length < 18 || wordCount(quote) < 3) {
      throw new Error(
        `Review Pulse representative quote at index ${index} must be substantive.`
      );
    }
  });

  if (pulse.action_ideas.length !== 3) {
    throw new Error("Review Pulse must contain exactly 3 action ideas.");
  }

  pulse.action_ideas.forEach((item, index) => {
    const idea = typeof item.idea === "string" ? item.idea.trim() : "";
    const theme = typeof item.based_on_theme === "string" ? item.based_on_theme.trim() : "";
    const evidence = typeof item.evidence === "string" ? item.evidence.trim() : "";
    if (!idea || !theme || !evidence) {
      throw new Error(
        `Review Pulse action idea at index ${index} must include idea, based_on_theme, and evidence.`
      );
    }
  });

  if (wordCount(pulse.weekly_summary) > 250) {
    throw new Error("Review Pulse summary must be 250 words or fewer.");
  }

  if (pulse.top_customer_themes.length !== 3) {
    throw new Error("Review Pulse must expose exactly 3 top customer themes.");
  }
}

function wordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}
