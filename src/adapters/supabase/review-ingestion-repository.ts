import { SupabaseClient } from "@supabase/supabase-js";

import {
  IngestionRunInput,
  IngestionRunPatch,
  ReviewIngestionRepository,
  StoredReviewInput
} from "../../services/reviews/types";

const REVIEW_ID_LOOKUP_BATCH_SIZE = 100;

export function createSupabaseReviewIngestionRepository(
  client: SupabaseClient
): ReviewIngestionRepository {
  return {
    async startIngestionRun(input: IngestionRunInput) {
      const { data, error } = await client
        .from("ingestion_runs")
        .insert({
          ...input,
          status: "partial_success"
        })
        .select("id")
        .single();

      if (error) {
        throw new Error(`Failed to start ingestion run: ${error.message}`);
      }

      return { id: data.id as string };
    },

    async getStoredReviewCount() {
      const { count, error } = await client
        .from("reviews")
        .select("*", { count: "exact", head: true });

      if (error) {
        throw new Error(`Failed to count reviews: ${error.message}`);
      }

      return count ?? 0;
    },

    async getExistingReviewIds(reviewIds: string[]) {
      if (reviewIds.length === 0) {
        return new Set<string>();
      }

      const existingReviewIds = new Set<string>();

      for (const reviewIdBatch of chunk(reviewIds, REVIEW_ID_LOOKUP_BATCH_SIZE)) {
        const { data, error } = await client
          .from("reviews")
          .select("review_id")
          .in("review_id", reviewIdBatch);

        if (error) {
          throw new Error(`Failed to read existing reviews: ${error.message}`);
        }

        for (const row of data ?? []) {
          existingReviewIds.add(row.review_id as string);
        }
      }

      return existingReviewIds;
    },

    async insertReviews(reviews: StoredReviewInput[]) {
      if (reviews.length === 0) {
        return;
      }

      const { error } = await client.from("reviews").insert(reviews);

      if (error) {
        throw new Error(`Failed to store reviews: ${error.message}`);
      }
    },

    async updateIngestionRun(runId: string, patch: IngestionRunPatch) {
      const { error } = await client.from("ingestion_runs").update(patch).eq("id", runId);

      if (error) {
        throw new Error(`Failed to update ingestion run ${runId}: ${error.message}`);
      }
    },

    async deleteReviewsWithReviewDateBefore(cutoffIso: string) {
      const { error, count } = await client
        .from("reviews")
        .delete({ count: "exact" })
        .lt("review_date", cutoffIso);

      if (error) {
        throw new Error(`Failed to prune old reviews: ${error.message}`);
      }

      return count ?? 0;
    }
  };
}

function chunk<T>(items: T[], batchSize: number) {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += batchSize) {
    batches.push(items.slice(index, index + batchSize));
  }
  return batches;
}
