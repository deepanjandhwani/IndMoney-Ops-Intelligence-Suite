"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AssistantSessionEventRow } from "@/adapters/supabase/assistant-history-repository";

const DEVICE_KEY = "groww-customer-assistant:device-id-v1";
const SESSION_KEY = "groww-customer-assistant:current-session-v1";

export type ClientHistoryAppendEvent = {
  role: "user" | "assistant";
  lane: "assistant" | "rag" | "scheduler";
  kind: string;
  content: string;
  citations?: unknown;
  status?: string;
  scheduler_state?: string;
  booking_code?: string;
  available_funds?: unknown;
  slots?: { id: string; label: string }[];
};

export type AssistantHistorySessionSummary = {
  id: string;
  label: string | null;
  lane_summary: { assistant: number; rag: number; scheduler: number };
  created_at: string;
  last_activity_at: string;
};

function readOrCreateDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing?.trim()) {
      return existing.trim();
    }
    const id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

function readSessionId(): string | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw?.trim() || null;
  } catch {
    return null;
  }
}

function writeSessionId(id: string) {
  try {
    localStorage.setItem(SESSION_KEY, id);
  } catch {
    /* private mode */
  }
}

export function useAssistantHistory() {
  const [deviceId, setDeviceId] = useState<string>("");
  const [sessionId, setSessionId] = useState<string | null>(null);

  const appendChain = useRef(Promise.resolve());

  useEffect(() => {
    const dev = readOrCreateDeviceId();
    setDeviceId(dev);
    const sid = readSessionId();
    if (sid) {
      setSessionId(sid);
    } else {
      const next = crypto.randomUUID();
      writeSessionId(next);
      setSessionId(next);
    }
  }, []);

  const persistSessionFromServer = useCallback((sid: string) => {
    writeSessionId(sid);
    setSessionId(sid);
  }, []);

  const appendEvent = useCallback((event: ClientHistoryAppendEvent) => {
    appendChain.current = appendChain.current
      .then(async () => {
        const dev = readOrCreateDeviceId();
        const sid = readSessionId();
        try {
          const res = await fetch("/api/assistant/history/append", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              device_id: dev,
              session_id: sid,
              event
            })
          });
          const data = (await res.json()) as { session_id?: string };
          if (res.ok && typeof data.session_id === "string") {
            persistSessionFromServer(data.session_id);
          }
        } catch {
          /* fire-and-forget */
        }
      })
      .catch(() => {});
  }, [persistSessionFromServer]);

  const startNewSession = useCallback(() => {
    const next = crypto.randomUUID();
    writeSessionId(next);
    setSessionId(next);
  }, []);

  const listSessions = useCallback(async (): Promise<AssistantHistorySessionSummary[]> => {
    const dev = deviceId || readOrCreateDeviceId();
    if (!dev) {
      return [];
    }
    const url = `/api/assistant/history/sessions?device_id=${encodeURIComponent(dev)}`;
    const res = await fetch(url);
    const data = (await res.json()) as { sessions?: AssistantHistorySessionSummary[]; error?: string };
    if (!res.ok) {
      throw new Error(data.error ?? "Failed to list history.");
    }
    return data.sessions ?? [];
  }, [deviceId]);

  const loadSessionTranscript = useCallback(async (id: string): Promise<AssistantSessionEventRow[]> => {
    const dev = deviceId || readOrCreateDeviceId();
    if (!dev) {
      return [];
    }
    const url = `/api/assistant/history/sessions/${encodeURIComponent(id)}?device_id=${encodeURIComponent(dev)}`;
    const res = await fetch(url);
    const data = (await res.json()) as { events?: AssistantSessionEventRow[]; error?: string };
    if (!res.ok) {
      throw new Error(data.error ?? "Failed to load session.");
    }
    return data.events ?? [];
  }, [deviceId]);

  const deleteSessionRemote = useCallback(
    async (id: string) => {
      const dev = deviceId || readOrCreateDeviceId();
      if (!dev) {
        return;
      }
      const url = `/api/assistant/history/sessions/${encodeURIComponent(id)}?device_id=${encodeURIComponent(dev)}`;
      await fetch(url, { method: "DELETE" });
    },
    [deviceId]
  );

  const clearAllRemote = useCallback(async () => {
    const dev = deviceId || readOrCreateDeviceId();
    if (!dev) {
      return;
    }
    const url = `/api/assistant/history?device_id=${encodeURIComponent(dev)}`;
    await fetch(url, { method: "DELETE" });
  }, [deviceId]);

  return useMemo(
    () => ({
      deviceId,
      sessionId,
      appendEvent,
      startNewSession,
      listSessions,
      loadSessionTranscript,
      deleteSessionRemote,
      clearAllRemote
    }),
    [
      deviceId,
      sessionId,
      appendEvent,
      startNewSession,
      listSessions,
      loadSessionTranscript,
      deleteSessionRemote,
      clearAllRemote
    ]
  );
}
