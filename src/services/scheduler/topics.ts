import { parseBookingCodeFromLooseInput } from "./booking-code";
import { SchedulerIntent, SchedulerTopic, SCHEDULER_TOPICS } from "./types";

export const STANDARD_ADVICE_REFUSAL =
  "I can't provide investment advice, future return predictions, or handle personal account information. I can help with facts from approved sources, such as NAV, AUM, exit load, expense ratio, lock-in, benchmark, riskometer, historic returns, fund manager, rating, fee explanation, or statement download steps. For investor education, see https://investor.sebi.gov.in/.";

export function buildTopicMenu(optional = false) {
  const intro = optional
    ? "Which topic should I prepare guidance for? You can also say skip."
    : "What would you like the advisor call to focus on?";

  return [
    intro,
    ...SCHEDULER_TOPICS.map((topic, index) => `${index + 1}. ${topic}`)
  ].join("\n");
}

export function matchTopic(input: string): SchedulerTopic | null {
  const lower = input.toLowerCase();

  const ordinalIndex = matchOrdinalIndex(lower, SCHEDULER_TOPICS.length);
  if (ordinalIndex !== null) {
    return SCHEDULER_TOPICS[ordinalIndex];
  }

  // Account Changes / Nominee MUST be checked before KYC so "account changes" doesn't match "change" → KYC
  if (/\b(5|account|nominee|nomi\s*nee|no\s*mini)\b/i.test(lower)) {
    return SCHEDULER_TOPICS[4];
  }
  if (/\b(1|kyc|k\s*y\s*c|k\.y\.c|kay\s*why\s*see|kay\s*wye\s*see|onboard|onboarding)\b/i.test(lower)) {
    return SCHEDULER_TOPICS[0];
  }
  if (/\b(2|sip|s\s*i\s*p|s\.i\.p|ess\s*eye\s*pee|mandate|mandates)\b/i.test(lower)) {
    return SCHEDULER_TOPICS[1];
  }
  if (/\b(3|statement|statements|tax|doc|docs|document|capital\s*gain)\b/i.test(lower)) {
    return SCHEDULER_TOPICS[2];
  }
  if (/\b(4|with\s*draw|withdraw|withdrawal|time\s*line|timeline|timelines)\b/i.test(lower)) {
    return SCHEDULER_TOPICS[3];
  }
  return null;
}

const ORDINALS: Array<{ pattern: RegExp; index: number }> = [
  { pattern: /\b(first|1st|option\s*one|number\s*one|the\s*first(\s*one)?)\b/, index: 0 },
  { pattern: /\b(second|2nd|option\s*two|number\s*two|the\s*second(\s*one)?)\b/, index: 1 },
  { pattern: /\b(third|3rd|option\s*three|number\s*three|the\s*third(\s*one)?)\b/, index: 2 },
  { pattern: /\b(fourth|4th|option\s*four|number\s*four|the\s*fourth(\s*one)?)\b/, index: 3 },
  { pattern: /\b(fifth|5th|option\s*five|number\s*five|the\s*fifth(\s*one)?|the\s*last(\s*one)?)\b/, index: 4 }
];

function matchOrdinalIndex(text: string, maxOptions: number): number | null {
  for (const { pattern, index } of ORDINALS) {
    if (index < maxOptions && pattern.test(text)) {
      return index;
    }
  }
  return null;
}

export function classifySchedulerIntent(input: string): SchedulerIntent | "advice" | "unclear" {
  const lower = input.toLowerCase();

  if (/\b(buy|sell|hold|recommend|return|returns|profit|portfolio|fund to invest)\b/.test(lower)) {
    return "advice";
  }
  if (/\b(cancel|drop|delete)\b/.test(lower)) {
    return "cancel";
  }
  if (/\b(reschedule|change.*slot|move.*meeting|different.*time)\b/.test(lower)) {
    return "reschedule";
  }
  if (/\b(prepare|bring|documents?|before.*call)\b/.test(lower)) {
    return "what_to_prepare";
  }
  // Prefer booking over browse: phrases like "book a slot" must not match check_availability's "slot" pattern.
  if (/\b(book|booking|schedule|advisor|appointment|meeting|call)\b/.test(lower)) {
    return "book_new";
  }
  if (/\b(available|availability|free slots?|slots?|timings?|times?)\b/.test(lower)) {
    return "check_availability";
  }

  return "unclear";
}

export function extractBookingCode(input: string) {
  const loose = parseBookingCodeFromLooseInput(input);
  if (loose) return loose;
  return input.toUpperCase().match(/\b[A-Z]{2}-[A-Z][0-9]{3}\b/)?.[0] ?? null;
}

export function isYes(input: string) {
  return /\b(yes|yep|yeah|confirm|ok|okay|please do|go ahead|looks good|sounds good|that works|perfect|sure|absolutely|definitely)\b/i.test(input);
}

export function isNo(input: string) {
  return /\b(no|nope|different|change|not now)\b/i.test(input);
}

export function isNegativeWithoutCancel(input: string) {
  return /\b(no|nope|different|change|not now)\b/i.test(input) && !/\bcancel\b/i.test(input);
}

export function buildPreparationGuidance(topic?: SchedulerTopic) {
  const topicText = topic ?? "your advisor discussion";
  return [
    `For ${topicText}, keep the discussion factual and account-safe.`,
    "You can prepare your goal for the call, relevant non-sensitive context, and any general questions you want the advisor to explain.",
    "Please do not share PAN, Aadhaar, OTP, phone, email, account number, full name, or address in this chat. If a booking is created, use the secure details link for personal details."
  ].join("\n");
}
