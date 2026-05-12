import { createGooglePlayReviewFetcher } from "../adapters/google-play/reviews";
import { createSupabaseAdminClient } from "../adapters/supabase/admin-client";
import { createSupabaseReviewIngestionRepository } from "../adapters/supabase/review-ingestion-repository";
import { runReviewIngestion } from "../services/reviews/ingest";

function parseEnvBoolean(value: string | undefined, defaultValue: boolean) {
  if (value === undefined || value === "") {
    return defaultValue;
  }
  const lower = value.trim().toLowerCase();
  if (["1", "true", "yes"].includes(lower)) {
    return true;
  }
  if (["0", "false", "no"].includes(lower)) {
    return false;
  }
  return defaultValue;
}

async function main() {
  const appId = process.env.GOOGLE_PLAY_PACKAGE_NAME ?? "com.nextbillion.groww";
  const maxPages = Number(process.env.GOOGLE_PLAY_REVIEW_MAX_PAGES ?? "40");
  const throttle = Number(process.env.GOOGLE_PLAY_REVIEW_THROTTLE ?? "8");
  const rollingWindowWeeks = Number(process.env.REVIEW_INGESTION_WINDOW_WEEKS ?? "12");
  const recurringFetchWeeks = Number(process.env.REVIEW_INGESTION_RECURRING_WINDOW_WEEKS ?? "1");
  const forceBackfill = parseEnvBoolean(process.env.REVIEW_INGESTION_FORCE_BACKFILL, false);
  const pruneOlderThanRollingWindow = parseEnvBoolean(
    process.env.REVIEW_INGESTION_PRUNE_OLD_REVIEWS,
    true
  );

  const supabase = createSupabaseAdminClient();
  const repository = createSupabaseReviewIngestionRepository(supabase);
  const fetchReviews = createGooglePlayReviewFetcher({
    appId,
    maxPages: Number.isFinite(maxPages) && maxPages > 0 ? maxPages : 40,
    throttle: Number.isFinite(throttle) && throttle > 0 ? throttle : 8
  });

  const result = await runReviewIngestion({
    fetchReviews,
    repository,
    rollingWindowWeeks,
    recurringFetchWeeks,
    forceBackfill,
    pruneOlderThanRollingWindow
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
