import { readFileSync } from "node:fs";
import { join } from "node:path";

import { SourceManifest } from "./types";

const SHORT_ALIASES = new Map<string, string>([
  ["defence", "HDFC Defence Fund Direct Growth"],
  ["defense", "HDFC Defence Fund Direct Growth"],
  ["military", "HDFC Defence Fund Direct Growth"],
  ["transportation", "HDFC Transportation and Logistics Fund Direct Growth"],
  ["logistics", "HDFC Transportation and Logistics Fund Direct Growth"],
  ["transport", "HDFC Transportation and Logistics Fund Direct Growth"],
  ["pharma", "HDFC Pharma and Healthcare Fund Direct Growth"],
  ["farma", "HDFC Pharma and Healthcare Fund Direct Growth"],
  ["healthcare", "HDFC Pharma and Healthcare Fund Direct Growth"],
  ["medicine", "HDFC Pharma and Healthcare Fund Direct Growth"],
  ["manufacturing", "HDFC Manufacturing Fund Direct Growth"],
  ["mid-cap", "HDFC Mid-Cap Fund Direct Plan Growth Option"],
  ["midca", "HDFC Mid-Cap Fund Direct Plan Growth Option"],
  ["midcap 150", "HDFC Nifty Midcap 150 Index Fund Direct Growth"],
  ["nifty midcap 150", "HDFC Nifty Midcap 150 Index Fund Direct Growth"],
  ["smallcap 250", "HDFC Nifty Smallcap 250 Index Fund Direct Growth"],
  ["small cap 250", "HDFC Nifty Smallcap 250 Index Fund Direct Growth"],
  ["nifty smallcap 250", "HDFC Nifty Smallcap 250 Index Fund Direct Growth"],
  ["next 50", "HDFC Nifty Next 50 Index Fund Direct Growth"],
  ["nifty next 50", "HDFC Nifty Next 50 Index Fund Direct Growth"],
  ["100 equal weight", "HDFC Nifty 100 Equal Weight Index Fund Direct Growth"],
  ["nifty 100 equal weight", "HDFC Nifty 100 Equal Weight Index Fund Direct Growth"],
  ["small cap", "HDFC Small Cap Fund Direct Growth Option"],
  ["infrastructure", "HDFC Infrastructure Fund Direct Plan Growth Option"],
  ["infra", "HDFC Infrastructure Fund Direct Plan Growth Option"],
  ["nifty50 equal weight", "HDFC Nifty50 Equal Weight Index Fund Direct Growth"],
  ["nifty 50 equal weight", "HDFC Nifty50 Equal Weight Index Fund Direct Growth"],
  ["value", "HDFC Value Fund Direct Plan Growth"],
  ["banking", "HDFC Banking & Financial Services Fund Direct Growth"],
  ["financial services", "HDFC Banking & Financial Services Fund Direct Growth"],
  ["bfsi", "HDFC Banking & Financial Services Fund Direct Growth"],
]);

/**
 * Group aliases resolve broad keywords to ALL matching funds in that category.
 * Checked before single-fund aliases so "midcap funds" matches both midcap
 * funds, not just the first one.
 */
const GROUP_ALIASES = new Map<string, string[]>([
  ["midcap", [
    "HDFC Mid-Cap Fund Direct Plan Growth Option",
    "HDFC Nifty Midcap 150 Index Fund Direct Growth",
  ]],
  ["mid cap", [
    "HDFC Mid-Cap Fund Direct Plan Growth Option",
    "HDFC Nifty Midcap 150 Index Fund Direct Growth",
  ]],
  ["smallcap", [
    "HDFC Small Cap Fund Direct Growth Option",
    "HDFC Nifty Smallcap 250 Index Fund Direct Growth",
  ]],
  ["small cap", [
    "HDFC Small Cap Fund Direct Growth Option",
    "HDFC Nifty Smallcap 250 Index Fund Direct Growth",
  ]],
]);

export type MentionedFundResult = {
  mentioned: string | null;
  isInSelection: boolean;
};

export type MentionedFundsResult = {
  funds: { canonical: string; inSelection: boolean }[];
};

/**
 * Sorted alias entries: longest alias first so "midcap 150" is tested before
 * "midcap" and doesn't get shadowed by a shorter substring match.
 */
const SORTED_ALIASES: [string, string][] = [...SHORT_ALIASES.entries()]
  .sort((a, b) => b[0].length - a[0].length);

const SORTED_GROUP_ALIASES: [string, string[]][] = [...GROUP_ALIASES.entries()]
  .sort((a, b) => b[0].length - a[0].length);

/**
 * Words too common to use as fund-matching keywords.
 * Without this, "fund" would match every single approved fund.
 */
const STOP_WORDS = new Set([
  "fund", "funds", "hdfc", "direct", "growth", "plan", "option",
  "the", "of", "and", "what", "is", "are", "for", "about",
  "tell", "me", "can", "you", "how", "why", "this", "that", "with",
  "its", "all", "any", "nav", "aum", "sip", "from", "has", "have",
  "not", "but", "also", "which", "where", "when", "give", "show",
  "get", "does", "will", "was", "were", "been", "being", "share",
]);

/**
 * Distinctive keywords extracted from each canonical fund name — used by
 * Layer 3 fuzzy matching. Excludes common words (HDFC, Fund, Direct, etc.)
 * to reduce false positives.
 */
const FUND_KEYWORDS: Map<string, string[]> = new Map();

function getFundKeywords(): Map<string, string[]> {
  if (FUND_KEYWORDS.size > 0) return FUND_KEYWORDS;
  for (const canonical of getApprovedSchemeNames()) {
    const tokens = normalizeText(canonical)
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
    FUND_KEYWORDS.set(canonical, tokens);
  }
  return FUND_KEYWORDS;
}

/**
 * Levenshtein edit distance between two strings. Used for typo tolerance.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= b.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[a.length][b.length];
}

/**
 * Compute the best fuzzy match score between a query token and a fund's
 * distinctive keywords. Returns a value between 0 and 1 (1 = exact match).
 */
function bestTokenMatchScore(queryToken: string, fundKeywords: string[]): number {
  let best = 0;
  for (const keyword of fundKeywords) {
    if (queryToken === keyword) return 1;
    const maxLen = Math.max(queryToken.length, keyword.length);
    if (maxLen === 0) continue;
    const dist = levenshtein(queryToken, keyword);
    const similarity = 1 - dist / maxLen;
    if (similarity > best) best = similarity;
  }
  return best;
}

const FUZZY_THRESHOLD = 0.75; // e.g. "farma" vs "pharma": 1 - 1/6 = 0.83 ✓
const MIN_QUERY_TOKEN_LENGTH = 4; // avoid matching short generic words

/**
 * Detect ALL mentioned funds in the query (by canonical name, short alias,
 * or fuzzy token match). Returns every distinct fund referenced, each flagged
 * with whether it's in the user's current selection.
 *
 * Three layers:
 *   1. Full canonical name as substring of query
 *   2. Alias lookup (longest-match-first)
 *   3. Fuzzy match: Levenshtein-based similarity between meaningful query
 *      tokens and distinctive fund name keywords (replaces old substring
 *      reverse-match that caused false positives)
 *
 * Set `options.fuzzy` false to skip layer 3 (stricter mentions only).
 */
export function detectMentionedFunds(
  query: string,
  selectedFunds: string[],
  options?: { fuzzy?: boolean },
): MentionedFundsResult {
  const useFuzzy = options?.fuzzy !== false;
  const lower = normalizeText(query);
  const selectionSet = new Set(selectedFunds);
  const seen = new Set<string>();
  const funds: MentionedFundsResult["funds"] = [];

  // Layer 1: query contains the full canonical name
  for (const canonical of getApprovedSchemeNames()) {
    if (lower.includes(normalizeText(canonical)) && !seen.has(canonical)) {
      seen.add(canonical);
      funds.push({ canonical, inSelection: selectionSet.has(canonical) });
    }
  }

  // Layer 2a: group alias lookup (longest-first) — resolves broad terms like
  // "midcap" to ALL matching funds in that category.
  for (const [alias, canonicals] of SORTED_GROUP_ALIASES) {
    if (lower.includes(alias)) {
      for (const canonical of canonicals) {
        if (!seen.has(canonical)) {
          seen.add(canonical);
          funds.push({ canonical, inSelection: selectionSet.has(canonical) });
        }
      }
    }
  }

  // Layer 2b: single alias lookup (longest-first)
  for (const [alias, canonical] of SORTED_ALIASES) {
    if (lower.includes(alias) && !seen.has(canonical)) {
      seen.add(canonical);
      funds.push({ canonical, inSelection: selectionSet.has(canonical) });
    }
  }

  // Layer 3: fuzzy match — extract meaningful tokens from the query and
  // compare against each fund's distinctive keywords using Levenshtein
  // distance. Only triggers on tokens long enough to be meaningful.
  const queryTokens = lower
    .split(/\s+/)
    .filter((t) => t.length >= MIN_QUERY_TOKEN_LENGTH && !STOP_WORDS.has(t));

  if (useFuzzy && queryTokens.length > 0) {
    const kwMap = getFundKeywords();
    const scored: { canonical: string; score: number }[] = [];

    for (const canonical of getApprovedSchemeNames()) {
      if (seen.has(canonical)) continue;
      const keywords = kwMap.get(canonical) ?? [];
      if (keywords.length === 0) continue;

      let maxScore = 0;
      for (const token of queryTokens) {
        const score = bestTokenMatchScore(token, keywords);
        if (score > maxScore) maxScore = score;
      }

      if (maxScore >= FUZZY_THRESHOLD) {
        scored.push({ canonical, score: maxScore });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    for (const { canonical } of scored) {
      if (!seen.has(canonical)) {
        seen.add(canonical);
        funds.push({ canonical, inSelection: selectionSet.has(canonical) });
      }
    }
  }

  return { funds };
}

/** Backwards-compatible single-fund wrapper used by older call sites. */
export function detectMentionedFund(
  query: string,
  selectedFunds: string[],
): MentionedFundResult {
  const { funds } = detectMentionedFunds(query, selectedFunds);
  if (funds.length === 0) {
    return { mentioned: null, isInSelection: true };
  }
  return { mentioned: funds[0].canonical, isInSelection: funds[0].inSelection };
}

export function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


let cachedApprovedSchemeNames: string[] | null = null;

export function getApprovedSchemeNames(): string[] {
  if (cachedApprovedSchemeNames) return cachedApprovedSchemeNames;
  try {
    const filePath = join(process.cwd(), "config/source_urls.json");
    const raw = readFileSync(filePath, "utf-8");
    const manifest = JSON.parse(raw) as SourceManifest;
    const names = manifest.sources
      .filter((source) => source.content_type === "scheme_fact" && source.scheme_name)
      .map((source) => source.scheme_name as string);
    cachedApprovedSchemeNames = names;
    return names;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[fund-resolver] failed to read config/source_urls.json: ${msg}`);
    return [];
  }
}

/** Test hook: clear the approved scheme names cache. */
export function _resetApprovedSchemeNamesCache() {
  cachedApprovedSchemeNames = null;
}
