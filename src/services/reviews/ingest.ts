import { maskPii } from "../safety/pii";
import { classifyReviewTextQuality } from "./review-quality";
import {
  FetchReviews,
  ReviewIngestionRepository,
  ReviewIngestionResult,
  SourceReview,
  StoredReviewInput
} from "./types";

export type RunReviewIngestionOptions = {
  fetchReviews: FetchReviews;
  repository: ReviewIngestionRepository;
  now?: Date;
  /** Rolling analysis / retention window (weeks). Pulse + prune use this. Default 12. */
  rollingWindowWeeks?: number;
  /** When the DB already has reviews, fetch only this many trailing weeks. Default 1. */
  recurringFetchWeeks?: number;
  /** Force full rolling-window fetch even if reviews exist (e.g. repair). */
  forceBackfill?: boolean;
  /** After success, delete reviews older than the rolling window. Default true. */
  pruneOlderThanRollingWindow?: boolean;
};

export async function runReviewIngestion({
  fetchReviews,
  repository,
  now = new Date(),
  rollingWindowWeeks = 12,
  recurringFetchWeeks = 1,
  forceBackfill = false,
  pruneOlderThanRollingWindow = true
}: RunReviewIngestionOptions): Promise<ReviewIngestionResult> {
  const rollingWeeksRounded = sanitizeWeeks(rollingWindowWeeks, 12);
  const recurringWeeksRounded = sanitizeWeeks(recurringFetchWeeks, 1);

  const storedCount = await repository.getStoredReviewCount();
  const ingestionMode =
    forceBackfill || storedCount === 0 ? "initial_backfill" : "incremental_fetch";
  const fetchWindowWeeks =
    ingestionMode === "initial_backfill" ? rollingWeeksRounded : recurringWeeksRounded;

  const windowEnd = now;
  const windowStart = subtractDays(windowEnd, fetchWindowWeeks * 7);
  const nextScheduledRun = addDays(now, 7);
  const run = await repository.startIngestionRun({
    review_window_start: toDateOnly(windowStart),
    review_window_end: toDateOnly(windowEnd),
    next_scheduled_run: nextScheduledRun.toISOString()
  });
  let reviewsFetched = 0;

  try {
    const fetchedReviews = await fetchReviews({ windowStart, windowEnd });
    reviewsFetched = fetchedReviews.length;
    const prepared = await prepareStoredReviews(fetchedReviews, repository, run.id, {
      windowStart,
      windowEnd
    });

    await repository.insertReviews(prepared.reviewsToStore);

    const status =
      fetchedReviews.length === 0 || prepared.reviewsFailed > 0
        ? "partial_success"
        : "success";
    const reviewsSkipped =
      prepared.duplicateReviewsSkipped +
      prepared.outsideWindowSkipped +
      prepared.lowInformationSkipped +
      prepared.languageSkipped;

    await repository.updateIngestionRun(run.id, {
      status,
      reviews_fetched: fetchedReviews.length,
      reviews_stored: prepared.reviewsToStore.length,
      reviews_skipped: reviewsSkipped,
      reviews_failed: prepared.reviewsFailed,
      error_message:
        fetchedReviews.length === 0
          ? "Google Play scraper returned 0 reviews; previous pulse preserved."
          : null
    });

    const retentionCutoff = subtractDays(now, rollingWeeksRounded * 7);
    let reviewsPruned: number | null = null;
    if (pruneOlderThanRollingWindow) {
      reviewsPruned = await repository.deleteReviewsWithReviewDateBefore(
        retentionCutoff.toISOString()
      );
    }

    return {
      runId: run.id,
      status,
      reviewsFetched: fetchedReviews.length,
      reviewsStored: prepared.reviewsToStore.length,
      reviewsSkipped,
      duplicateReviewsSkipped: prepared.duplicateReviewsSkipped,
      outsideWindowSkipped: prepared.outsideWindowSkipped,
      lowInformationSkipped: prepared.lowInformationSkipped,
      languageSkipped: prepared.languageSkipped,
      reviewsFailed: prepared.reviewsFailed,
      windowStart: toDateOnly(windowStart),
      windowEnd: toDateOnly(windowEnd),
      ingestionMode,
      fetchWindowWeeks,
      rollingWindowWeeks: rollingWeeksRounded,
      reviewsPruned
    };
  } catch (error) {
    await repository.updateIngestionRun(run.id, {
      status: "failed",
      reviews_fetched: reviewsFetched,
      reviews_stored: 0,
      reviews_skipped: 0,
      reviews_failed: 1,
      error_message: error instanceof Error ? error.message : "Unknown ingestion failure"
    });
    throw error;
  }
}

function sanitizeWeeks(value: number, fallback: number) {
  if (!Number.isFinite(value) || value < 1) {
    return fallback;
  }
  return Math.floor(value);
}

async function prepareStoredReviews(
  fetchedReviews: SourceReview[],
  repository: ReviewIngestionRepository,
  ingestionRunId: string,
  window: { windowStart: Date; windowEnd: Date }
) {
  const inWindowReviews = fetchedReviews.filter(
    (review) => review.reviewDate >= window.windowStart && review.reviewDate <= window.windowEnd
  );
  const outsideWindowSkipped = fetchedReviews.length - inWindowReviews.length;
  const schemaValidReviews = inWindowReviews.filter(isValidSourceReview);
  const reviewsFailed = inWindowReviews.length - schemaValidReviews.length;

  let lowInformationSkipped = 0;
  let languageSkipped = 0;
  const qualityPassedReviews: SourceReview[] = [];
  for (const review of schemaValidReviews) {
    const outcome = classifyReviewTextQuality(review.text);
    if (!outcome.ok) {
      if (outcome.reason === "low_information") {
        lowInformationSkipped += 1;
      } else {
        languageSkipped += 1;
      }
      continue;
    }
    qualityPassedReviews.push(review);
  }

  const existingReviewIds = await repository.getExistingReviewIds(
    qualityPassedReviews.map((review) => review.reviewId)
  );
  const seenReviewIds = new Set<string>();
  const reviewsToStore: StoredReviewInput[] = [];
  let duplicateReviewsSkipped = 0;

  for (const review of qualityPassedReviews) {
    if (seenReviewIds.has(review.reviewId) || existingReviewIds.has(review.reviewId)) {
      duplicateReviewsSkipped += 1;
      continue;
    }

    seenReviewIds.add(review.reviewId);
    const { maskedText } = maskPii(review.text);
    reviewsToStore.push({
      review_id: review.reviewId,
      review_text: maskedText,
      rating: review.rating,
      review_date: review.reviewDate.toISOString(),
      source: review.source,
      ingestion_run_id: ingestionRunId
    });
  }

  return {
    reviewsToStore,
    duplicateReviewsSkipped,
    outsideWindowSkipped,
    lowInformationSkipped,
    languageSkipped,
    reviewsFailed
  };
}

function isValidSourceReview(review: SourceReview) {
  return (
    review.reviewId.trim().length > 0 &&
    review.text.trim().length > 0 &&
    Number.isInteger(review.rating) &&
    review.rating >= 1 &&
    review.rating <= 5 &&
    !Number.isNaN(review.reviewDate.valueOf())
  );
}

function subtractDays(date: Date, days: number) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() - days);
  return result;
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function toDateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}
