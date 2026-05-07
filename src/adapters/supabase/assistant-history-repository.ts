import { SupabaseClient } from "@supabase/supabase-js";

import { PiiFinding } from "@/services/safety/pii";

export type AssistantLane = "assistant" | "rag" | "scheduler";

export type AssistantHistoryRole = "user" | "assistant";

export type AssistantSessionListRow = {
  id: string;
  label: string | null;
  lane_summary: LaneSummary;
  created_at: string;
  last_activity_at: string;
};

export type LaneSummary = {
  assistant: number;
  rag: number;
  scheduler: number;
};

export type NewAssistantSessionEvent = {
  role: AssistantHistoryRole;
  lane: AssistantLane;
  kind: string;
  content: string;
  pii_masked: boolean;
  pii_findings: PiiFinding[];
  citations?: unknown;
  status?: string | null;
  scheduler_state?: string | null;
  booking_code?: string | null;
  available_funds?: unknown;
  slots?: { id: string; label: string }[] | null;
};

export type AssistantSessionEventRow = {
  id: string;
  session_id: string;
  seq: number;
  role: AssistantHistoryRole;
  lane: AssistantLane;
  kind: string;
  content: string;
  pii_masked: boolean;
  pii_findings: unknown;
  citations: unknown;
  status: string | null;
  scheduler_state: string | null;
  booking_code: string | null;
  available_funds: unknown;
  slots: unknown;
  created_at: string;
};

const defaultLaneSummary = (): LaneSummary => ({
  assistant: 0,
  rag: 0,
  scheduler: 0
});

function normalizeLaneSummary(raw: unknown): LaneSummary {
  if (!raw || typeof raw !== "object") {
    return defaultLaneSummary();
  }
  const o = raw as Record<string, unknown>;
  return {
    assistant: typeof o.assistant === "number" ? o.assistant : 0,
    rag: typeof o.rag === "number" ? o.rag : 0,
    scheduler: typeof o.scheduler === "number" ? o.scheduler : 0
  };
}

export class AssistantSessionOwnershipError extends Error {
  constructor(message = "Session does not belong to this device.") {
    super(message);
    this.name = "AssistantSessionOwnershipError";
  }
}

function ownershipMatches(
  session: { device_id_hash: string; user_id?: string | null },
  deviceIdHash: string,
  userId?: string | null
): boolean {
  if (userId && session.user_id === userId) return true;
  return session.device_id_hash === deviceIdHash;
}

export function createAssistantHistoryRepository(client: SupabaseClient) {
  return {
    async ensureSession(params: {
      deviceIdHash: string;
      sessionId?: string | null;
      userId?: string | null;
    }): Promise<string> {
      const { deviceIdHash, sessionId, userId } = params;

      if (sessionId) {
        const { data: existing, error: selectError } = await client
          .from("assistant_sessions")
          .select("id, device_id_hash, user_id")
          .eq("id", sessionId)
          .maybeSingle();

        if (selectError) {
          throw new Error(`Failed to read assistant session: ${selectError.message}`);
        }

        if (existing) {
          if (!ownershipMatches(existing, deviceIdHash, userId)) {
            throw new AssistantSessionOwnershipError();
          }
          const patch: Record<string, unknown> = { last_activity_at: new Date().toISOString() };
          if (userId && !existing.user_id) {
            patch.user_id = userId;
          }
          const { error: touchError } = await client
            .from("assistant_sessions")
            .update(patch)
            .eq("id", sessionId);

          if (touchError) {
            throw new Error(`Failed to update assistant session: ${touchError.message}`);
          }
          return sessionId;
        }

        const row: Record<string, unknown> = {
          id: sessionId,
          device_id_hash: deviceIdHash,
          lane_summary: defaultLaneSummary(),
          last_activity_at: new Date().toISOString()
        };
        if (userId) row.user_id = userId;

        const { data: inserted, error: insertError } = await client
          .from("assistant_sessions")
          .insert(row)
          .select("id")
          .single();

        if (insertError) {
          throw new Error(`Failed to create assistant session: ${insertError.message}`);
        }
        return inserted.id as string;
      }

      const row: Record<string, unknown> = {
        device_id_hash: deviceIdHash,
        lane_summary: defaultLaneSummary(),
        last_activity_at: new Date().toISOString()
      };
      if (userId) row.user_id = userId;

      const { data: created, error: createError } = await client
        .from("assistant_sessions")
        .insert(row)
        .select("id")
        .single();

      if (createError) {
        throw new Error(`Failed to create assistant session: ${createError.message}`);
      }
      return created.id as string;
    },

    async appendEvent(
      sessionId: string,
      deviceIdHash: string,
      event: NewAssistantSessionEvent,
      userId?: string | null
    ): Promise<number> {
      const { data: session, error: sessionError } = await client
        .from("assistant_sessions")
        .select("id, device_id_hash, user_id, label, lane_summary")
        .eq("id", sessionId)
        .maybeSingle();

      if (sessionError) {
        throw new Error(`Failed to read session for append: ${sessionError.message}`);
      }
      if (!session || !ownershipMatches(session, deviceIdHash, userId)) {
        throw new AssistantSessionOwnershipError();
      }

      const { data: maxRow, error: maxError } = await client
        .from("assistant_session_events")
        .select("seq")
        .eq("session_id", sessionId)
        .order("seq", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (maxError) {
        throw new Error(`Failed to read event seq: ${maxError.message}`);
      }

      const nextSeq = typeof maxRow?.seq === "number" ? maxRow.seq + 1 : 1;

      const summary = normalizeLaneSummary(session.lane_summary);
      const laneKey = event.lane;
      summary[laneKey] = (summary[laneKey] ?? 0) + 1;

      const labelPatch: { label?: string } = {};
      if (event.role === "user" && !session.label && event.content.trim()) {
        labelPatch.label = event.content.trim().slice(0, 120);
      }

      const { error: updateSessionError } = await client
        .from("assistant_sessions")
        .update({
          lane_summary: summary,
          last_activity_at: new Date().toISOString(),
          ...labelPatch
        })
        .eq("id", sessionId);

      if (updateSessionError) {
        throw new Error(`Failed to update session summary: ${updateSessionError.message}`);
      }

      const { error: insertEventError } = await client.from("assistant_session_events").insert({
        session_id: sessionId,
        seq: nextSeq,
        role: event.role,
        lane: event.lane,
        kind: event.kind,
        content: event.content,
        pii_masked: event.pii_masked,
        pii_findings: event.pii_findings,
        citations: event.citations ?? null,
        status: event.status ?? null,
        scheduler_state: event.scheduler_state ?? null,
        booking_code: event.booking_code ?? null,
        available_funds: event.available_funds ?? null,
        slots: event.slots ?? null
      });

      if (insertEventError) {
        throw new Error(`Failed to append assistant event: ${insertEventError.message}`);
      }

      return nextSeq;
    },

    async listSessionsForDevice(
      deviceIdHash: string,
      options: { limit?: number; userId?: string | null } = {}
    ): Promise<AssistantSessionListRow[]> {
      const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);

      let query = client
        .from("assistant_sessions")
        .select("id, label, lane_summary, created_at, last_activity_at");

      if (options.userId) {
        query = query.or(`device_id_hash.eq.${deviceIdHash},user_id.eq.${options.userId}`);
      } else {
        query = query.eq("device_id_hash", deviceIdHash);
      }

      const { data, error } = await query
        .order("last_activity_at", { ascending: false })
        .limit(limit);

      if (error) {
        throw new Error(`Failed to list assistant sessions: ${error.message}`);
      }

      return (data ?? []).map((row) => ({
        id: row.id as string,
        label: (row.label as string | null) ?? null,
        lane_summary: normalizeLaneSummary(row.lane_summary),
        created_at: row.created_at as string,
        last_activity_at: row.last_activity_at as string
      }));
    },

    async getSessionTranscript(
      sessionId: string,
      deviceIdHash: string,
      userId?: string | null
    ): Promise<AssistantSessionEventRow[] | null> {
      const { data: session, error: sessionError } = await client
        .from("assistant_sessions")
        .select("id, device_id_hash, user_id")
        .eq("id", sessionId)
        .maybeSingle();

      if (sessionError) {
        throw new Error(`Failed to read assistant session: ${sessionError.message}`);
      }
      if (!session || !ownershipMatches(session, deviceIdHash, userId)) {
        return null;
      }

      const { data: events, error: eventsError } = await client
        .from("assistant_session_events")
        .select(
          "id, session_id, seq, role, lane, kind, content, pii_masked, pii_findings, citations, status, scheduler_state, booking_code, available_funds, slots, created_at"
        )
        .eq("session_id", sessionId)
        .order("seq", { ascending: true });

      if (eventsError) {
        throw new Error(`Failed to read assistant transcript: ${eventsError.message}`);
      }

      return (events ?? []) as AssistantSessionEventRow[];
    },

    async deleteSession(
      sessionId: string,
      deviceIdHash: string,
      userId?: string | null
    ): Promise<boolean> {
      const { data: session, error: readError } = await client
        .from("assistant_sessions")
        .select("id, device_id_hash, user_id")
        .eq("id", sessionId)
        .maybeSingle();

      if (readError) {
        throw new Error(`Failed to read assistant session: ${readError.message}`);
      }
      if (!session || !ownershipMatches(session, deviceIdHash, userId)) {
        return false;
      }

      const { error: delError } = await client.from("assistant_sessions").delete().eq("id", sessionId);

      if (delError) {
        throw new Error(`Failed to delete assistant session: ${delError.message}`);
      }
      return true;
    },

    async deleteAllForDevice(deviceIdHash: string): Promise<number> {
      const { data, error } = await client
        .from("assistant_sessions")
        .delete()
        .eq("device_id_hash", deviceIdHash)
        .select("id");

      if (error) {
        throw new Error(`Failed to delete assistant sessions: ${error.message}`);
      }
      return (data ?? []).length;
    }
  };
}

export type AssistantHistoryRepository = ReturnType<typeof createAssistantHistoryRepository>;
