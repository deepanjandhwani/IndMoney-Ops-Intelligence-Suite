import { createHash } from "node:crypto";

import googlePlayScraper, { Review } from "google-play-scraper";

import { FetchReviews, FetchReviewsOptions, SourceReview } from "../../services/reviews/types";

export type GooglePlayReviewAdapterOptions = {
  appId: string;
  country?: string;
  lang?: string;
  /** Ignored when paginating; kept for API compatibility. */
  reviewLimit?: number;
  /** Max paginated requests per ingestion (free-tier safety). */
  maxPages?: number;
  /** Requests per second cap for google-play-scraper (reduces 503 risk). */
  throttle?: number;
};

const DEFAULT_MAX_PAGES = 40;

export function createGooglePlayReviewFetcher({
  appId,
  country = "in",
  lang = "en",
  maxPages = DEFAULT_MAX_PAGES,
  throttle = 8
}: GooglePlayReviewAdapterOptions): FetchReviews {
  return async ({ windowStart, windowEnd }: FetchReviewsOptions) => {
    const collected: SourceReview[] = [];
    let nextToken: string | null | undefined = null;

    for (let page = 0; page < maxPages; page += 1) {
      const response = await googlePlayScraper.reviews({
        appId,
        country,
        lang,
        sort: googlePlayScraper.sort.NEWEST,
        paginate: true,
        nextPaginationToken: nextToken ?? undefined,
        throttle
      });

      const batch = response.data ?? [];
      if (batch.length === 0) {
        break;
      }

      const normalizedPage = batch.flatMap(normalizeGooglePlayReview);
      for (const review of normalizedPage) {
        if (review.reviewDate >= windowStart && review.reviewDate <= windowEnd) {
          collected.push(review);
        }
      }

      const oldestInPage = oldestNormalizedDateMs(normalizedPage, batch);
      if (oldestInPage !== null && oldestInPage < windowStart.getTime()) {
        break;
      }

      nextToken = response.nextPaginationToken;
      if (!nextToken) {
        break;
      }
    }

    return collected;
  };
}

function oldestNormalizedDateMs(normalized: SourceReview[], rawBatch: Review[]): number | null {
  let min = Infinity;
  for (const r of normalized) {
    const t = r.reviewDate.getTime();
    if (!Number.isNaN(t)) {
      min = Math.min(min, t);
    }
  }
  if (min !== Infinity) {
    return min;
  }
  for (const row of rawBatch) {
    const dateValue = row.at ?? row.date;
    const d = dateValue ? new Date(dateValue).getTime() : Number.NaN;
    if (!Number.isNaN(d)) {
      min = Math.min(min, d);
    }
  }
  return min === Infinity ? null : min;
}

function normalizeGooglePlayReview(review: Review): SourceReview[] {
  const text = (review.content ?? review.text)?.trim();
  const rating = Number(review.score);
  const dateValue = review.at ?? review.date;
  const reviewDate = dateValue ? new Date(dateValue) : new Date(Number.NaN);

  if (!text || !Number.isInteger(rating) || Number.isNaN(reviewDate.valueOf())) {
    return [];
  }

  return [
    {
      reviewId: review.id?.trim() || fallbackReviewId(text, rating, reviewDate),
      text,
      rating,
      reviewDate,
      source: "google_play"
    }
  ];
}

function fallbackReviewId(text: string, rating: number, reviewDate: Date) {
  return createHash("sha256")
    .update([text, rating, reviewDate.toISOString()].join("|"))
    .digest("hex");
}
