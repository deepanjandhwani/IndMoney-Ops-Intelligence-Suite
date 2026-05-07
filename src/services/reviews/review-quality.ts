/**
 * Filters low-information and unsupported-script reviews before storage.
 * Keeps Hinglish (Latin script); skips emoji-only and conservative non-Latin-only cases.
 */

const ACTION_KEYWORD_PATTERN =
  /\b(login|crash|kyc|withdraw|statement|nominee|sip|mandate|payment|failed)\b/i;

/** Latin-script hints that often appear even in mixed-language complaints */
const PRODUCT_TERM_PATTERN =
  /\b(groww|mutual\s*fund|mf\b|folio|dashboard|portfolio|demat|upi|imps|neft|otp|bank)\b/i;

const LETTER = /\p{L}/u;
const LATIN_SCRIPT_LETTER = /\p{Script=Latin}/u;

export type ReviewQualityOutcome =
  | { ok: true }
  | { ok: false; reason: "low_information" | "unsupported_language" };

/**
 * Removes emoji (extended pictographic) and most punctuation/symbols,
 * leaving letters and numbers for signal checks.
 */
export function strippedLettersAndDigits(text: string): string {
  const noEmoji = text.replace(/\p{Extended_Pictographic}/gu, "");
  return noEmoji.replace(/[^\p{L}\p{N}]/gu, "");
}

export function hasLetterOrDigitSignal(text: string): boolean {
  return strippedLettersAndDigits(text).length > 0;
}

function meaningfulTokens(text: string): string[] {
  const collapsed = text
    .replace(/\p{Extended_Pictographic}/gu, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .toLowerCase();
  return collapsed.split(/\s+/).filter((token) => token.length > 0 && /[\p{L}\p{N}]/u.test(token));
}

export function hasActionableKeyword(text: string): boolean {
  return ACTION_KEYWORD_PATTERN.test(text) || PRODUCT_TERM_PATTERN.test(text);
}

export function passesLowInformationGate(text: string): boolean {
  if (!hasLetterOrDigitSignal(text)) {
    return false;
  }
  const tokens = meaningfulTokens(text);
  if (tokens.length >= 5) {
    return true;
  }
  return hasActionableKeyword(text);
}

/**
 * Non-Latin–dominated review without Latin operational/product hints → skip.
 */
export function passesLanguageHeuristic(text: string): boolean {
  const stripped = strippedLettersAndDigits(text);
  let latinLetters = 0;
  let nonLatinLetters = 0;
  for (const char of stripped) {
    if (!LETTER.test(char)) {
      continue;
    }
    if (LATIN_SCRIPT_LETTER.test(char)) {
      latinLetters += 1;
    } else {
      nonLatinLetters += 1;
    }
  }
  const letters = latinLetters + nonLatinLetters;
  if (letters === 0) {
    return hasLetterOrDigitSignal(text);
  }
  const dominatedByNonLatin =
    letters >= 8 &&
    nonLatinLetters >= latinLetters * 2 &&
    latinLetters <= Math.max(2, nonLatinLetters / 4);
  if (!dominatedByNonLatin) {
    return true;
  }
  return hasActionableKeyword(text);
}

export function classifyReviewTextQuality(text: string): ReviewQualityOutcome {
  if (!passesLowInformationGate(text)) {
    return { ok: false, reason: "low_information" };
  }
  if (!passesLanguageHeuristic(text)) {
    return { ok: false, reason: "unsupported_language" };
  }
  return { ok: true };
}
