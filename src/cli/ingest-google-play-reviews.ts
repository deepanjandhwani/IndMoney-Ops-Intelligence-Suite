import { createGooglePlayReviewFetcher } from "../adapters/google-play/reviews";
import { createSupabaseAdminClient } from "../adapters/supabase/admin-client";
import { createSupabaseReviewIngestionRepository } from "../adapters/supabase/review-ingestion-repository";
import { runReviewIngestion } from "../services/reviews/ingest";

async function main() {
  const appId = process.env.GOOGLE_PLAY_PACKAGE_NAME ?? "com.nextbillion.groww";
  const reviewLimit = Number(process.env.GOOGLE_PLAY_REVIEW_LIMIT ?? "500");
  const windowWeeks = Number(process.env.REVIEW_INGESTION_WINDOW_WEEKS ?? "12");
  const supabase = createSupabaseAdminClient();
  const repository = createSupabaseReviewIngestionRepository(supabase);
  const fetchReviews = createGooglePlayReviewFetcher({
    appId,
    reviewLimit
  });

  const result = await runReviewIngestion({
    fetchReviews,
    repository,
    windowWeeks
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
