import { BookingCodeRepository } from "./booking-code";
import {
  BookingRecord,
  BookingStatus,
  CalendarStatus,
  CustomerEmailDraftStatus,
  EmailDraftStatus,
  HitlActionRecord,
  HitlActionType,
  HitlStatus,
  InputMode,
  LatestReviewPulse,
  SchedulerTopic,
  SecureDetailsSubmission,
  SheetStatus
} from "./types";

export type CreateBookingInput = {
  booking_code: string;
  topic: SchedulerTopic;
  slot_start: string;
  slot_end: string;
  input_mode: InputMode;
  secure_details_token_hash: string;
  secure_link_expires_at: string;
  customer_id?: string;
};

export type BookingPatch = Partial<{
  topic: SchedulerTopic;
  slot_start: string;
  slot_end: string;
  status: BookingStatus;
  secure_link_submitted: boolean;
  calendar_event_id: string | null;
  sheet_row_id: string | null;
  email_draft_id: string | null;
  customer_email_draft_id: string | null;
  customer_email_draft_status: CustomerEmailDraftStatus;
  calendar_status: CalendarStatus;
  sheet_status: SheetStatus;
  email_draft_status: EmailDraftStatus;
}>;

export type CreateHitlActionInput = {
  booking_id: string;
  booking_code: string;
  action_type: HitlActionType;
  target_booking_status: BookingStatus;
  payload: Record<string, unknown>;
  calendar_status: CalendarStatus;
  sheet_status: SheetStatus;
  email_draft_status: EmailDraftStatus;
};

export type HitlActionPatch = Partial<{
  status: HitlStatus;
  target_booking_status: BookingStatus;
  payload: Record<string, unknown>;
  admin_notes: string | null;
  calendar_status: CalendarStatus;
  sheet_status: SheetStatus;
  email_draft_status: EmailDraftStatus;
}>;

export type StoreSecureDetailsInput = {
  booking_id: string;
  booking_code: string;
  token_hash: string;
  details_ciphertext: string;
  expires_at: string;
};

export type SchedulerRepository = BookingCodeRepository & {
  getLatestReviewPulse: () => Promise<LatestReviewPulse | null>;
  createBooking: (input: CreateBookingInput) => Promise<BookingRecord>;
  updateBooking: (bookingId: string, patch: BookingPatch) => Promise<BookingRecord>;
  getBookingByCode: (bookingCode: string) => Promise<BookingRecord | null>;
  getBookingBySecureTokenHash: (tokenHash: string) => Promise<BookingRecord | null>;
  createHitlAction: (input: CreateHitlActionInput) => Promise<HitlActionRecord>;
  updateHitlAction: (hitlActionId: string, patch: HitlActionPatch) => Promise<HitlActionRecord>;
  getHitlAction: (hitlActionId: string) => Promise<HitlActionRecord | null>;
  listHitlActions: (status?: HitlStatus) => Promise<HitlActionRecord[]>;
  getLatestHitlActionForBooking: (
    bookingId: string,
    actionType?: HitlActionType
  ) => Promise<HitlActionRecord | null>;
  storeSecureDetails: (input: StoreSecureDetailsInput) => Promise<SecureDetailsSubmission>;
  getSecureDetailsForBooking: (bookingId: string) => Promise<SecureDetailsSubmission | null>;
};
