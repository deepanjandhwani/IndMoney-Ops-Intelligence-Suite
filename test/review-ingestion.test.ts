import { describe, expect, it } from "vitest";

import { runReviewIngestion } from "../src/services/reviews/ingest";
import {
  IngestionRunInput,
  IngestionRunPatch,
  ReviewIngestionRepository,
  SourceReview,
  StoredReviewInput
} from "../src/services/reviews/types";

describe("runReviewIngestion", () => {
  it("dedupes reviews, masks PII, and counts skipped duplicates", async () => {
    const insertedReviews: StoredReviewInput[] = [];
    const updates: IngestionRunPatch[] = [];
    const repository = createFakeRepository({
      existingIds: new Set(["existing-review"]),
      insertedReviews,
      updates
    });
    const now = new Date("2026-04-30T12:00:00.000Z");

    const result = await runReviewIngestion({
      repository,
      now,
      fetchReviews: async () => [
        review("new-review", "Please call me at 9876543210 about nominee issue.", 1, now),
        review(
          "existing-review",
          "Already stored review text that meets minimum token length for ingestion pipeline.",
          2,
          now
        ),
        review("same-batch", "Login OTP is 123456 and app is stuck.", 1, now),
        review("same-batch", "Login OTP is 123456 and app is stuck.", 1, now),
        review("old-review", "Old review outside rolling window.", 3, new Date("2026-01-01"))
      ]
    });

    expect(result.status).toBe("success");
    expect(result.reviewsFetched).toBe(5);
    expect(result.reviewsStored).toBe(2);
    expect(result.duplicateReviewsSkipped).toBe(2);
    expect(result.outsideWindowSkipped).toBe(1);
    expect(result.lowInformationSkipped).toBe(0);
    expect(result.languageSkipped).toBe(0);
    expect(result.reviewsSkipped).toBe(3);
    expect(insertedReviews).toHaveLength(2);
    expect(insertedReviews.map((storedReview) => storedReview.review_id)).toEqual([
      "new-review",
      "same-batch"
    ]);
    expect(insertedReviews[0].review_text).not.toContain("9876543210");
    expect(insertedReviews[1].review_text).not.toContain("123456");
    expect(updates.at(-1)).toMatchObject({
      status: "success",
      reviews_fetched: 5,
      reviews_stored: 2,
      reviews_skipped: 3,
      reviews_failed: 0
    });
  });

  it("skips low-information in-window reviews before storage", async () => {
    const insertedReviews: StoredReviewInput[] = [];
    const repository = createFakeRepository({ insertedReviews });
    const now = new Date("2026-04-30T12:00:00.000Z");

    const result = await runReviewIngestion({
      repository,
      now,
      fetchReviews: async () => [
        review("ok-review", "This nominee verification issue repeats across sessions.", 2, now),
        review("spam-review", "👍👍👍", 5, now),
        review("tiny-review", "meh ok", 3, now)
      ]
    });

    expect(result.lowInformationSkipped).toBe(2);
    expect(result.reviewsStored).toBe(1);
    expect(insertedReviews).toHaveLength(1);
    expect(insertedReviews[0].review_id).toBe("ok-review");
  });

  it("preserves previous pulse when scraper returns zero reviews", async () => {
    const updates: IngestionRunPatch[] = [];
    const repository = createFakeRepository({ updates });

    const result = await runReviewIngestion({
      repository,
      now: new Date("2026-04-30T12:00:00.000Z"),
      fetchReviews: async () => []
    });

    expect(result.status).toBe("partial_success");
    expect(result.reviewsFetched).toBe(0);
    expect(result.reviewsStored).toBe(0);
    expect(updates.at(-1)?.error_message).toContain("previous pulse preserved");
  });

  it("marks the ingestion run failed when the scraper throws", async () => {
    const updates: IngestionRunPatch[] = [];
    const repository = createFakeRepository({ updates });

    await expect(
      runReviewIngestion({
        repository,
        fetchReviews: async () => {
          throw new Error("scraper unavailable");
        }
      })
    ).rejects.toThrow("scraper unavailable");

    expect(updates.at(-1)).toMatchObject({
      status: "failed",
      reviews_failed: 1,
      error_message: "scraper unavailable"
    });
  });
});

function review(
  reviewId: string,
  text: string,
  rating: number,
  reviewDate: Date
): SourceReview {
  return {
    reviewId,
    text,
    rating,
    reviewDate,
    source: "google_play"
  };
}

function createFakeRepository(options: {
  existingIds?: Set<string>;
  insertedReviews?: StoredReviewInput[];
  updates?: IngestionRunPatch[];
} = {}): ReviewIngestionRepository {
  const insertedReviews = options.insertedReviews ?? [];
  const updates = options.updates ?? [];

  return {
    async startIngestionRun(_input: IngestionRunInput) {
      return { id: "run-1" };
    },
    async getExistingReviewIds() {
      return options.existingIds ?? new Set<string>();
    },
    async insertReviews(reviewsToInsert: StoredReviewInput[]) {
      insertedReviews.push(...reviewsToInsert);
    },
    async updateIngestionRun(_runId: string, patch: IngestionRunPatch) {
      updates.push(patch);
    }
  };
}
