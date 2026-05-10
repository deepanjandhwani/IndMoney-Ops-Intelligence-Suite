export const SCHEDULER_TOPICS = [
  "KYC / Onboarding",
  "SIP / Mandates",
  "Statements / Tax Docs",
  "Withdrawals & Timelines",
  "Account Changes / Nominee"
] as const;

export type SchedulerTopic = (typeof SCHEDULER_TOPICS)[number];

export type SchedulerIntent =
  | "book_new"
  | "reschedule"
  | "cancel"
  | "what_to_prepare"
  | "check_availability";

export type SchedulerState =
  | "intent_classification"
  | "reschedule_scope"
  | "topic_collection"
  | "topic_collection_optional"
  | "time_collection"
  | "booking_code_collection"
  | "slot_selection"
  | "offer_waitlist"
  | "confirmation"
  | "cancellation_confirm"
  | "closing"
  | "terminal";

export type InputMode = "chat" | "voice";
export type TimeWindowPreference = "morning" | "afternoon" | "evening";

export type BookingStatus =
  | "pending_admin_confirmation"
  | "confirmed"
  | "reschedule_requested"
  | "rescheduled"
  | "cancel_requested"
  | "cancelled"
  | "rejected";

export type HitlActionType = "confirm" | "reschedule" | "cancel" | "reject";
export type HitlStatus = "pending" | "approved" | "rejected" | "executed" | "failed";
export type CalendarStatus = "pending" | "created" | "updated" | "cancelled" | "failed";
export type SheetStatus = "pending" | "created" | "updated" | "cancelled" | "failed";
export type EmailDraftStatus = "pending" | "created" | "updated" | "sent" | "failed";

export type SlotOption = {
  id: string;
  start_time: string;
  end_time: string;
  label: string;
};

export type SchedulerSessionContext = {
  state: SchedulerState;
  input_mode: InputMode;
  intent?: SchedulerIntent;
  topic?: SchedulerTopic;
  preferred_date?: string;
  requested_day_label?: string;
  time_window?: TimeWindowPreference;
  booking_code?: string;
  selected_slot?: SlotOption;
  slots_offered?: SlotOption[];
  last_prompt?: string;
  retry_count: number;
  customer_id?: string;
};

export type SchedulerOutput = {
  response_text: string;
  next_state: SchedulerState;
  context: SchedulerSessionContext;
  booking_code?: string;
  slots_offered?: SlotOption[];
  secure_link?: string;
  my_bookings_redirect?: boolean;
  pii_warning?: boolean;
};

export type LatestReviewPulse = {
  top_customer_themes: string[];
  weekly_summary: string;
};

export type CustomerEmailDraftStatus = "pending" | "created" | "updated" | "sent" | "failed";

export type BookingRecord = {
  id: string;
  booking_code: string;
  product: "Groww";
  topic: SchedulerTopic;
  slot_start: string;
  slot_end: string;
  status: BookingStatus;
  input_mode: InputMode;
  secure_link_submitted: boolean;
  secure_details_token_hash?: string | null;
  secure_link_expires_at?: string | null;
  calendar_event_id?: string | null;
  sheet_row_id?: string | null;
  email_draft_id?: string | null;
  customer_email_draft_id?: string | null;
  customer_email_draft_status: CustomerEmailDraftStatus;
  customer_id?: string | null;
  calendar_status: CalendarStatus;
  sheet_status: SheetStatus;
  email_draft_status: EmailDraftStatus;
  created_at?: string;
  updated_at?: string;
};

export type HitlActionRecord = {
  id: string;
  booking_id: string;
  booking_code: string;
  action_type: HitlActionType;
  status: HitlStatus;
  target_booking_status: BookingStatus;
  payload: Record<string, unknown>;
  admin_notes?: string | null;
  calendar_status: CalendarStatus;
  sheet_status: SheetStatus;
  email_draft_status: EmailDraftStatus;
  created_at?: string;
  updated_at?: string;
};

export type SecureDetailsSubmission = {
  booking_id: string;
  booking_code: string;
  token_hash: string;
  details_ciphertext: string;
  expires_at: string;
};
