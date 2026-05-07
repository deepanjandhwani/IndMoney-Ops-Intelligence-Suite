export type ReviewIngestionStatus = "failed" | "partial_success" | "success";

export type ReviewSource = "google_play";

export type SourceReview = {
  reviewId: string;
  text: string;
  rating: number;
  reviewDate: Date;
  source: ReviewSource;
};

export type StoredReviewInput = {
  review_id: string;
  review_text: string;
  rating: number;
  review_date: string;
  source: ReviewSource;
  ingestion_run_id: string;
};

export type IngestionRunInput = {
  review_window_start: string;
  review_window_end: string;
  next_scheduled_run: string;
};

export type IngestionRunPatch = {
  status: ReviewIngestionStatus;
  reviews_fetched: number;
  reviews_stored: number;
  reviews_skipped: number;
  reviews_failed: number;
  error_message?: string | null;
};

export type ReviewIngestionRepository = {
  startIngestionRun: (input: IngestionRunInput) => Promise<{ id: string }>;
  getExistingReviewIds: (reviewIds: string[]) => Promise<Set<string>>;
  insertReviews: (reviews: StoredReviewInput[]) => Promise<void>;
  updateIngestionRun: (runId: string, patch: IngestionRunPatch) => Promise<void>;
};

export type FetchReviewsOptions = {
  windowStart: Date;
  windowEnd: Date;
};

export type FetchReviews = (options: FetchReviewsOptions) => Promise<SourceReview[]>;

export type ReviewIngestionResult = {
  runId: string;
  status: ReviewIngestionStatus;
  reviewsFetched: number;
  reviewsStored: number;
  reviewsSkipped: number;
  duplicateReviewsSkipped: number;
  outsideWindowSkipped: number;
  lowInformationSkipped: number;
  languageSkipped: number;
  reviewsFailed: number;
  windowStart: string;
  windowEnd: string;
};
