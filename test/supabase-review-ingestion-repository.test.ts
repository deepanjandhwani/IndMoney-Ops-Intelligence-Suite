import { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { createSupabaseReviewIngestionRepository } from "../src/adapters/supabase/review-ingestion-repository";

describe("createSupabaseReviewIngestionRepository", () => {
  it("chunks existing review ID lookups to avoid oversized requests", async () => {
    const queriedBatches: string[][] = [];
    const client = {
      from(tableName: string) {
        expect(tableName).toBe("reviews");
        return {
          select(columnName: string) {
            expect(columnName).toBe("review_id");
            return {
              async in(filterColumn: string, reviewIds: string[]) {
                expect(filterColumn).toBe("review_id");
                queriedBatches.push(reviewIds);
                return {
                  data: reviewIds.includes("review-42")
                    ? [{ review_id: "review-42" }]
                    : [],
                  error: null
                };
              }
            };
          }
        };
      }
    } as unknown as SupabaseClient;

    const repository = createSupabaseReviewIngestionRepository(client);
    const existingReviewIds = await repository.getExistingReviewIds(
      Array.from({ length: 101 }, (_, index) => `review-${index}`)
    );

    expect(queriedBatches).toHaveLength(2);
    expect(queriedBatches.map((batch) => batch.length)).toEqual([100, 1]);
    expect(existingReviewIds).toEqual(new Set(["review-42"]));
  });
});
