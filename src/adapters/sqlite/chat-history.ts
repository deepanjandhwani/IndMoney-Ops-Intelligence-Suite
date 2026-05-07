import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import type {
  AssistantHistoryRepository,
  AssistantSessionEventRow,
  AssistantSessionListRow,
  NewAssistantSessionEvent
} from "@/adapters/supabase/assistant-history-repository";
import { AssistantSessionOwnershipError } from "@/adapters/supabase/assistant-history-repository";

const DATA_DIR = join(process.cwd(), ".data");
const DB_PATH = join(DATA_DIR, "chat-history.sqlite");

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (_db) return _db;

  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS assistant_sessions (
      id TEXT PRIMARY KEY,
      device_id_hash TEXT NOT NULL,
      label TEXT,
      lane_summary TEXT NOT NULL DEFAULT '{"assistant":0,"rag":0,"scheduler":0}',
      created_at TEXT NOT NULL,
      last_activity_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS assistant_sessions_device_last_activity_idx
      ON assistant_sessions (device_id_hash, last_activity_at DESC);

    CREATE TABLE IF NOT EXISTS assistant_session_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES assistant_sessions(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user','assistant')),
      lane TEXT NOT NULL CHECK(lane IN ('assistant','rag','scheduler')),
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      pii_masked INTEGER NOT NULL DEFAULT 0,
      pii_findings TEXT NOT NULL DEFAULT '[]',
      citations TEXT,
      status TEXT,
      scheduler_state TEXT,
      booking_code TEXT,
      available_funds TEXT,
      slots TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(session_id, seq)
    );

    CREATE INDEX IF NOT EXISTS assistant_session_events_session_seq_idx
      ON assistant_session_events (session_id, seq);
  `);

  _db = db;
  return db;
}

function now(): string {
  return new Date().toISOString();
}

function parseLaneSummary(raw: string | null): { assistant: number; rag: number; scheduler: number } {
  try {
    return JSON.parse(raw ?? "{}") as { assistant: number; rag: number; scheduler: number };
  } catch {
    return { assistant: 0, rag: 0, scheduler: 0 };
  }
}

function parseJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function createSqliteChatHistoryRepository(): AssistantHistoryRepository {
  return {
    async ensureSession(params: { deviceIdHash: string; sessionId?: string | null; userId?: string | null }) {
      const db = getDb();
      const { deviceIdHash, sessionId } = params;

      if (sessionId) {
        const existing = db.prepare("SELECT id, device_id_hash FROM assistant_sessions WHERE id = ?").get(sessionId) as
          | { id: string; device_id_hash: string }
          | undefined;

        if (existing) {
          if (existing.device_id_hash !== deviceIdHash) {
            throw new AssistantSessionOwnershipError();
          }
          db.prepare("UPDATE assistant_sessions SET last_activity_at = ? WHERE id = ?").run(now(), sessionId);
          return sessionId;
        }

        db.prepare(
          "INSERT INTO assistant_sessions (id, device_id_hash, lane_summary, created_at, last_activity_at) VALUES (?, ?, ?, ?, ?)"
        ).run(sessionId, deviceIdHash, JSON.stringify({ assistant: 0, rag: 0, scheduler: 0 }), now(), now());
        return sessionId;
      }

      const id = randomUUID();
      db.prepare(
        "INSERT INTO assistant_sessions (id, device_id_hash, lane_summary, created_at, last_activity_at) VALUES (?, ?, ?, ?, ?)"
      ).run(id, deviceIdHash, JSON.stringify({ assistant: 0, rag: 0, scheduler: 0 }), now(), now());
      return id;
    },

    async appendEvent(sessionId: string, deviceIdHash: string, event: NewAssistantSessionEvent, _userId?: string | null) {
      const db = getDb();

      const session = db
        .prepare("SELECT id, device_id_hash, label, lane_summary FROM assistant_sessions WHERE id = ?")
        .get(sessionId) as { id: string; device_id_hash: string; label: string | null; lane_summary: string } | undefined;

      if (!session || session.device_id_hash !== deviceIdHash) {
        throw new AssistantSessionOwnershipError();
      }

      const maxRow = db
        .prepare("SELECT seq FROM assistant_session_events WHERE session_id = ? ORDER BY seq DESC LIMIT 1")
        .get(sessionId) as { seq: number } | undefined;

      const nextSeq = typeof maxRow?.seq === "number" ? maxRow.seq + 1 : 1;

      const summary = parseLaneSummary(session.lane_summary);
      summary[event.lane] = (summary[event.lane] ?? 0) + 1;

      const labelPatch =
        event.role === "user" && !session.label && event.content.trim()
          ? event.content.trim().slice(0, 120)
          : session.label;

      db.prepare(
        "UPDATE assistant_sessions SET lane_summary = ?, last_activity_at = ?, label = ? WHERE id = ?"
      ).run(JSON.stringify(summary), now(), labelPatch, sessionId);

      db.prepare(
        `INSERT INTO assistant_session_events
         (id, session_id, seq, role, lane, kind, content, pii_masked, pii_findings,
          citations, status, scheduler_state, booking_code, available_funds, slots, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        randomUUID(),
        sessionId,
        nextSeq,
        event.role,
        event.lane,
        event.kind,
        event.content,
        event.pii_masked ? 1 : 0,
        JSON.stringify(event.pii_findings ?? []),
        event.citations !== undefined ? JSON.stringify(event.citations) : null,
        event.status ?? null,
        event.scheduler_state ?? null,
        event.booking_code ?? null,
        event.available_funds !== undefined ? JSON.stringify(event.available_funds) : null,
        event.slots ? JSON.stringify(event.slots) : null,
        now()
      );

      return nextSeq;
    },

    async listSessionsForDevice(deviceIdHash: string, options: { limit?: number; userId?: string | null } = {}) {
      const db = getDb();
      const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);
      const rows = db
        .prepare(
          "SELECT id, label, lane_summary, created_at, last_activity_at FROM assistant_sessions WHERE device_id_hash = ? ORDER BY last_activity_at DESC LIMIT ?"
        )
        .all(deviceIdHash, limit) as Array<{
        id: string;
        label: string | null;
        lane_summary: string;
        created_at: string;
        last_activity_at: string;
      }>;

      return rows.map((row): AssistantSessionListRow => ({
        id: row.id,
        label: row.label,
        lane_summary: parseLaneSummary(row.lane_summary),
        created_at: row.created_at,
        last_activity_at: row.last_activity_at
      }));
    },

    async getSessionTranscript(sessionId: string, deviceIdHash: string, _userId?: string | null) {
      const db = getDb();
      const session = db
        .prepare("SELECT id, device_id_hash FROM assistant_sessions WHERE id = ?")
        .get(sessionId) as { id: string; device_id_hash: string } | undefined;

      if (!session || session.device_id_hash !== deviceIdHash) {
        return null;
      }

      const events = db
        .prepare(
          `SELECT id, session_id, seq, role, lane, kind, content, pii_masked, pii_findings,
                  citations, status, scheduler_state, booking_code, available_funds, slots, created_at
           FROM assistant_session_events WHERE session_id = ? ORDER BY seq ASC`
        )
        .all(sessionId) as Array<Record<string, unknown>>;

      return events.map((e): AssistantSessionEventRow => ({
        id: e.id as string,
        session_id: e.session_id as string,
        seq: e.seq as number,
        role: e.role as "user" | "assistant",
        lane: e.lane as "assistant" | "rag" | "scheduler",
        kind: e.kind as string,
        content: e.content as string,
        pii_masked: Boolean(e.pii_masked),
        pii_findings: parseJson(e.pii_findings as string | null),
        citations: parseJson(e.citations as string | null),
        status: (e.status as string | null) ?? null,
        scheduler_state: (e.scheduler_state as string | null) ?? null,
        booking_code: (e.booking_code as string | null) ?? null,
        available_funds: parseJson(e.available_funds as string | null),
        slots: parseJson(e.slots as string | null),
        created_at: e.created_at as string
      }));
    },

    async deleteSession(sessionId: string, deviceIdHash: string, _userId?: string | null) {
      const db = getDb();
      const session = db
        .prepare("SELECT id, device_id_hash FROM assistant_sessions WHERE id = ?")
        .get(sessionId) as { id: string; device_id_hash: string } | undefined;

      if (!session || session.device_id_hash !== deviceIdHash) {
        return false;
      }

      db.prepare("DELETE FROM assistant_sessions WHERE id = ?").run(sessionId);
      return true;
    },

    async deleteAllForDevice(deviceIdHash) {
      const db = getDb();
      const result = db
        .prepare("DELETE FROM assistant_sessions WHERE device_id_hash = ?")
        .run(deviceIdHash);
      return result.changes;
    }
  };
}
