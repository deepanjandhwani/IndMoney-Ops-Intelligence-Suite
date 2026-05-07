export const SMART_SYNC_COLLECTION = "smart-sync-kb";
export const EMBEDDING_DIMENSIONS = 768;

export type SourceType = "official_url" | "static_fee_explainer";
export type ContentType =
  | "scheme_fact"
  | "fee_explanation"
  | "regulatory_education"
  | "help_page";

export type ScrapeStatus = "success" | "failed" | "pending";

export type SourceConfig = {
  source_id: string;
  url: string | null;
  source_type: SourceType;
  content_type: ContentType;
  title: string;
  last_checked: string;
  scrape_status: ScrapeStatus;
  scheme_name?: string;
  topic?: string;
  fee_type?: string;
};

export type SourceManifest = {
  sources: SourceConfig[];
};

export type ChunkMetadata = {
  source_id: string;
  source_type: SourceType;
  content_type: ContentType;
  title: string;
  url: string | null;
  last_checked: string;
  content_hash: string;
  chunk_index: number;
  scheme_name?: string;
  section_type?: string;
  fee_type?: string;
  scenario?: string;
  topic?: string;
};

export type ChunkDocument = {
  id: string;
  text: string;
  metadata: ChunkMetadata;
};

export type EmbeddedChunk = ChunkDocument & {
  embedding: number[];
};

export type QueryCategory =
  | "scheme_fact"
  | "fee_explanation"
  | "process_help"
  | "regulatory_education"
  | "multi_source"
  | "greeting"
  | "out_of_scope";

export type QueryClassification = {
  category: QueryCategory;
  extracted_scheme_name: string | null;
  extracted_fee_type: string | null;
  extracted_topic: string | null;
  confidence: number;
  matched_scheme_names?: string[];
  query_scope?: "single_fund" | "multi_fund" | "all_funds" | "unspecified";
};

export type RetrievalCandidate = {
  id: string;
  text: string;
  metadata: ChunkMetadata;
  distance: number;
  cosineScore: number;
  bm25Score: number;
  relevanceScore: number;
};

export type Citation = {
  source_url: string | null;
  source_id: string;
  source_title: string;
  last_checked: string;
  content_type: ContentType;
};

export type FaqAnswerStatus = "answered" | "refused" | "no_results" | "fund_mismatch";

export type ConversationTurn = {
  role: "user" | "assistant";
  text: string;
};

export type FaqAnswer = {
  answer: string;
  citations: Citation[];
  status: FaqAnswerStatus;
  health_error?: string;
  pii_masked?: boolean;
  /** The canonical fund name that was actually used to answer this question. */
  resolved_fund?: string | null;
  /** When the query mentions a fund not in the user's selection, this is the
   *  canonical name they should add to their filter. */
  suggested_fund?: string | null;
  /** When the query mentions multiple funds not in the user's selection. */
  suggested_funds?: string[];
};
