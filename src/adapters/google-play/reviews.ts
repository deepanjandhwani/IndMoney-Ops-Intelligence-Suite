import { createHash } from "node:crypto";

import googlePlayScraper, { Review } from "google-play-scraper";

import { FetchReviews, SourceReview } from "../../services/reviews/types";

export type GooglePlayReviewAdapterOptions = {
  appId: string;
  country?: string;
  lang?: string;
  reviewLimit?: number;
};

export function createGooglePlayReviewFetcher({
  appId,
  country = "in",
  lang = "en",
  reviewLimit = 500
}: GooglePlayReviewAdapterOptions): FetchReviews {
  return async () => {
    const response = await googlePlayScraper.reviews({
      appId,
      country,
      lang,
      num: reviewLimit,
      sort: googlePlayScraper.sort.NEWEST
    });

    const reviews = response.data ?? [];
    return reviews.flatMap(normalizeGooglePlayReview);
  };
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
