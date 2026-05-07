import { SupabaseClient } from "@supabase/supabase-js";

import {
  BookingPatch,
  CreateBookingInput,
  CreateHitlActionInput,
  HitlActionPatch,
  SchedulerRepository,
  StoreSecureDetailsInput
} from "../../services/scheduler/repository";
import {
  BookingRecord,
  HitlActionRecord,
  HitlActionType,
  HitlStatus,
  LatestReviewPulse,
  SecureDetailsSubmission
} from "../../services/scheduler/types";

export function createSupabaseSchedulerRepository(client: SupabaseClient): SchedulerRepository {
  return {
    async bookingCodeExists(bookingCode: string) {
      const { data, error } = await client
        .from("bookings")
        .select("booking_code")
        .eq("booking_code", bookingCode)
        .maybeSingle();

      if (error) {
        throw new Error(`Failed to check booking code: ${error.message}`);
      }

      return Boolean(data);
    },

    async getLatestReviewPulse() {
      const { data, error } = await client
        .from("review_pulse")
        .select("top_customer_themes, weekly_summary")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        throw new Error(`Failed to read latest Review Pulse: ${error.message}`);
      }
      if (!data) {
        return null;
      }

      return {
        top_customer_themes: arrayOfStrings(data.top_customer_themes),
        weekly_summary: String(data.weekly_summary ?? "")
      } satisfies LatestReviewPulse;
    },

    async createBooking(input: CreateBookingInput) {
      const row: Record<string, unknown> = {
        booking_code: input.booking_code,
        product: "Groww",
        topic: input.topic,
        slot_start: input.slot_start,
        slot_end: input.slot_end,
        input_mode: input.input_mode,
        secure_details_token_hash: input.secure_details_token_hash,
        secure_link_expires_at: input.secure_link_expires_at
      };
      if (input.customer_id) {
        row.customer_id = input.customer_id;
      }
      const { data, error } = await client
        .from("bookings")
        .insert(row)
        .select("*")
        .single();

      if (error) {
        throw new Error(`Failed to create booking: ${error.message}`);
      }

      return data as BookingRecord;
    },

    async updateBooking(bookingId: string, patch: BookingPatch) {
      const { data, error } = await client
        .from("bookings")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", bookingId)
        .select("*")
        .single();

      if (error) {
        throw new Error(`Failed to update booking ${bookingId}: ${error.message}`);
      }

      return data as BookingRecord;
    },

    async getBookingByCode(bookingCode: string) {
      const { data, error } = await client
        .from("bookings")
        .select("*")
        .eq("booking_code", bookingCode)
        .maybeSingle();

      if (error) {
        throw new Error(`Failed to read booking ${bookingCode}: ${error.message}`);
      }

      return (data as BookingRecord | null) ?? null;
    },

    async getBookingBySecureTokenHash(tokenHash: string) {
      const { data, error } = await client
        .from("bookings")
        .select("*")
        .eq("secure_details_token_hash", tokenHash)
        .maybeSingle();

      if (error) {
        throw new Error(`Failed to read booking by secure token: ${error.message}`);
      }

      return (data as BookingRecord | null) ?? null;
    },

    async createHitlAction(input: CreateHitlActionInput) {
      const { data, error } = await client
        .from("hitl_actions")
        .insert({
          booking_id: input.booking_id,
          booking_code: input.booking_code,
          action_type: input.action_type,
          target_booking_status: input.target_booking_status,
          payload: input.payload,
          calendar_status: input.calendar_status,
          sheet_status: input.sheet_status,
          email_draft_status: input.email_draft_status
        })
        .select("*")
        .single();

      if (error) {
        throw new Error(`Failed to create HITL action: ${error.message}`);
      }

      return data as HitlActionRecord;
    },

    async updateHitlAction(hitlActionId: string, patch: HitlActionPatch) {
      const { data, error } = await client
        .from("hitl_actions")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", hitlActionId)
        .select("*")
        .single();

      if (error) {
        throw new Error(`Failed to update HITL action ${hitlActionId}: ${error.message}`);
      }

      return data as HitlActionRecord;
    },

    async getHitlAction(hitlActionId: string) {
      const { data, error } = await client
        .from("hitl_actions")
        .select("*")
        .eq("id", hitlActionId)
        .maybeSingle();

      if (error) {
        throw new Error(`Failed to read HITL action ${hitlActionId}: ${error.message}`);
      }

      return (data as HitlActionRecord | null) ?? null;
    },

    async listHitlActions(status?: HitlStatus) {
      let query = client
        .from("hitl_actions")
        .select("*")
        .order("created_at", { ascending: false });

      if (status) {
        query = query.eq("status", status);
      }

      const { data, error } = await query.limit(50);
      if (error) {
        throw new Error(`Failed to list HITL actions: ${error.message}`);
      }

      return (data ?? []) as HitlActionRecord[];
    },

    async getLatestHitlActionForBooking(bookingId: string, actionType?: HitlActionType) {
      let query = client
        .from("hitl_actions")
        .select("*")
        .eq("booking_id", bookingId)
        .order("created_at", { ascending: false });

      if (actionType) {
        query = query.eq("action_type", actionType);
      }

      const { data, error } = await query.limit(1).maybeSingle();
      if (error) {
        throw new Error(`Failed to read latest HITL action: ${error.message}`);
      }

      return (data as HitlActionRecord | null) ?? null;
    },

    async storeSecureDetails(input: StoreSecureDetailsInput) {
      const { data, error } = await client
        .from("secure_details_submissions")
        .upsert({
          booking_id: input.booking_id,
          booking_code: input.booking_code,
          token_hash: input.token_hash,
          details_ciphertext: input.details_ciphertext,
          details_metadata: { encrypted: true },
          expires_at: input.expires_at
        })
        .select("*")
        .single();

      if (error) {
        throw new Error(`Failed to store secure details: ${error.message}`);
      }

      return data as SecureDetailsSubmission;
    },

    async getSecureDetailsForBooking(bookingId: string) {
      const { data, error } = await client
        .from("secure_details_submissions")
        .select("*")
        .eq("booking_id", bookingId)
        .maybeSingle();

      if (error) {
        throw new Error(`Failed to read secure details: ${error.message}`);
      }

      return (data as SecureDetailsSubmission | null) ?? null;
    }
  };
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
