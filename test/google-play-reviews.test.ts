import { describe, expect, it, vi } from "vitest";

const { reviewsMock } = vi.hoisted(() => ({
  reviewsMock: vi.fn()
}));

vi.mock("google-play-scraper", () => ({
  default: {
    reviews: reviewsMock,
    sort: {
      NEWEST: 2
    }
  }
}));

import { createGooglePlayReviewFetcher } from "../src/adapters/google-play/reviews";

describe("createGooglePlayReviewFetcher", () => {
  it("normalizes reviews from the scraper response data array", async () => {
    reviewsMock.mockResolvedValue({
      data: [
        {
          id: "review-1",
          text: "Nominee update is stuck.",
          score: 2,
          date: "2026-04-30T10:00:00.000Z"
        },
        {
          id: "empty-review",
          text: "",
          score: 5,
          date: "2026-04-30T10:00:00.000Z"
        }
      ],
      nextPaginationToken: null
    });

    const fetchReviews = createGooglePlayReviewFetcher({
      appId: "com.nextbillion.groww",
      reviewLimit: 2
    });

    const reviews = await fetchReviews({
      windowStart: new Date("2026-04-01T00:00:00.000Z"),
      windowEnd: new Date("2026-04-30T23:59:59.999Z")
    });

    expect(reviews).toEqual([
      {
        reviewId: "review-1",
        text: "Nominee update is stuck.",
        rating: 2,
        reviewDate: new Date("2026-04-30T10:00:00.000Z"),
        source: "google_play"
      }
    ]);
    expect(reviewsMock).toHaveBeenCalledWith({
      appId: "com.nextbillion.groww",
      country: "in",
      lang: "en",
      num: 2,
      sort: 2
    });
  });
});
