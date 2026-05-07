import { Citation, RetrievalCandidate } from "./types";

export function citationsFromCandidates(candidates: RetrievalCandidate[]): Citation[] {
  const citations = new Map<string, Citation>();

  for (const candidate of candidates) {
    const metadata = candidate.metadata;
    const key = `${metadata.source_id}:${metadata.last_checked}`;
    if (citations.has(key)) {
      continue;
    }

    citations.set(key, {
      source_url: metadata.url,
      source_id: metadata.source_id,
      source_title: metadata.title,
      last_checked: metadata.last_checked,
      content_type: metadata.content_type
    });
  }

  return Array.from(citations.values());
}

function tokenizeForOverlap(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s%]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3);
}

function groundingRatio(answer: string, chunkText: string): number {
  const chunkTokens = [...new Set(tokenizeForOverlap(chunkText))];
  if (chunkTokens.length === 0) {
    return 1;
  }
  const answerTokens = [...new Set(tokenizeForOverlap(answer))];
  if (answerTokens.length === 0) {
    return 0;
  }
  const chunkSet = new Set(chunkTokens);
  const answerSet = new Set(answerTokens);

  // Forward: fraction of chunk tokens present in the answer
  const forward = chunkTokens.filter((t) => answerSet.has(t)).length / chunkTokens.length;
  // Reverse: fraction of answer tokens present in the chunks — catches short
  // factual answers that are clearly drawn from the source even though they
  // only use a small slice of a large chunk.
  const reverse = answerTokens.filter((t) => chunkSet.has(t)).length / answerTokens.length;

  return Math.max(forward, reverse);
}

const COMMON_TITLE_WORDS = new Set([
  "hdfc", "fund", "funds", "direct", "growth", "plan", "option", "index"
]);

function titleWordHits(answer: string, title: string): number {
  const lower = answer.toLowerCase();
  const words = title
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !COMMON_TITLE_WORDS.has(w));
  return words.filter((w) => lower.includes(w)).length;
}

/** Inline citation pattern used by older prompts and eval fixtures. */
function legacyCitationValidation(answer: string, citations: Citation[]): boolean {
  const referencedCitations = citations.filter((citation) => {
    const hasSource =
      answer.includes(citation.source_id) ||
      (citation.source_url ? answer.includes(citation.source_url) : false) ||
      answer.includes(citation.source_title);
    return hasSource && answer.includes(citation.last_checked);
  });

  if (referencedCitations.length === 0) {
    return false;
  }

  const hasFeeContext = citations.some((citation) => citation.source_id === "fee_static_001");
  if (hasFeeContext && !answer.includes("fee_static_001")) {
    return false;
  }

  const hasOfficialContext = citations.some((citation) => citation.source_url);
  if (hasOfficialContext) {
    return referencedCitations.some((citation) => Boolean(citation.source_url));
  }

  return true;
}

/**
 * Ensures the answer is grounded in retrieved citations.
 *
 * Semantics (mirrors the pre-prose-answer validator):
 *   • At least ONE citation must be grounded in the answer
 *     (token overlap with chunk text, source_url present, or title words match).
 *   • If fee_static_001 chunks were retrieved AND the answer is fee-themed,
 *     the fee_static_001 grounding must hold (loose lexical check).
 *
 * Supports legacy inline "(source_id …; Last checked …)" fixtures and the new
 * prose-only answers (where inline ids are stripped before display).
 */
export function hasRequiredCitations(
  answer: string,
  citations: Citation[],
  candidates: RetrievalCandidate[] = []
): boolean {
  if (citations.length === 0) {
    return false;
  }

  const trimmed = answer.trim();
  if (trimmed.length < 15) {
    return false;
  }

  if (legacyCitationValidation(trimmed, citations)) {
    return true;
  }

  if (candidates.length === 0) {
    return false;
  }

  const bySource = new Map<string, string>();
  for (const cand of candidates) {
    const sid = cand.metadata.source_id;
    bySource.set(sid, `${bySource.get(sid) ?? ""}\n${cand.text}`);
  }

  const MIN_RATIO = 0.11;

  let groundedCount = 0;
  let feeGrounded = false;
  const failedSourceIds: string[] = [];

  for (const c of citations) {
    const blob = bySource.get(c.source_id) ?? "";
    const ratio = blob ? groundingRatio(trimmed, blob) : 0;

    const grounded =
      ratio >= MIN_RATIO ||
      (c.source_url ? trimmed.includes(c.source_url) : false) ||
      titleWordHits(trimmed, c.source_title) >= 2;

    if (grounded) {
      groundedCount += 1;
      if (c.source_id === "fee_static_001") feeGrounded = true;
    } else {
      failedSourceIds.push(`${c.source_id}@${ratio.toFixed(2)}`);
    }
  }

  const hasFeeContext = citations.some((c) => c.source_id === "fee_static_001");
  const isFeeThemed = /\b(exit load|expense ratio|stamp duty|brokerage fee|entry load|12b|gst|stt)\b/i.test(
    trimmed
  );

  if (groundedCount === 0) {
    console.warn(
      `[citation-check] no citation grounded — failures: ${failedSourceIds.join(", ")}`
    );
    return false;
  }

  if (hasFeeContext && isFeeThemed && !feeGrounded) {
    console.warn(
      `[citation-check] fee_static_001 chunks retrieved but not grounded in fee-themed answer`
    );
    return false;
  }

  return true;
}
