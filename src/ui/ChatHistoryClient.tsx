"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MessageSquare,
  ChevronRight,
  ArrowLeft,
  Trash2,
  Loader2,
  AlertCircle
} from "lucide-react";
import { useAssistantHistory, AssistantHistorySessionSummary } from "@/ui/useAssistantHistory";
import type { AssistantSessionEventRow } from "@/adapters/supabase/assistant-history-repository";

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3 } }
};

const laneColors: Record<string, string> = {
  rag: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  scheduler: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  assistant: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300"
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata"
  });
}

export function ChatHistoryClient() {
  const history = useAssistantHistory();
  const [sessions, setSessions] = useState<AssistantHistorySessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<AssistantSessionEventRow[]>([]);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  async function loadSessions() {
    setLoading(true);
    setError(null);
    try {
      const data = await history.listSessions();
      setSessions(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function openSession(id: string) {
    setActiveSession(id);
    setTranscriptLoading(true);
    try {
      const events = await history.loadSessionTranscript(id);
      setTranscript(events);
    } catch {
      setTranscript([]);
    } finally {
      setTranscriptLoading(false);
    }
  }

  async function deleteSession(id: string) {
    setDeleting(id);
    try {
      await history.deleteSessionRemote(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (activeSession === id) {
        setActiveSession(null);
        setTranscript([]);
      }
    } finally {
      setDeleting(null);
    }
  }

  useEffect(() => {
    if (history.deviceId) {
      loadSessions();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history.deviceId]);

  if (activeSession) {
    const session = sessions.find((s) => s.id === activeSession);
    return (
      <motion.div
        className="max-w-3xl mx-auto p-4 md:p-8 space-y-4"
        initial="hidden"
        animate="show"
        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04 } } }}
      >
        <motion.div variants={fadeUp}>
          <button
            type="button"
            onClick={() => { setActiveSession(null); setTranscript([]); }}
            className="!bg-transparent !p-0 !text-accent !shadow-none flex items-center gap-1 text-sm font-semibold mb-3"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to sessions
          </button>
          <h2
            className="text-lg font-[520] tracking-[-0.02em]"
            style={{ fontFamily: "Georgia, 'Times New Roman', serif", color: "var(--ink-soft)" }}
          >
            {session?.label || "Session"}
          </h2>
          <p className="text-xs text-muted">
            {session && formatDate(session.created_at)}
          </p>
        </motion.div>

        {transcriptLoading ? (
          <div className="flex items-center gap-3 text-muted py-10">
            <Loader2 className="w-5 h-5 animate-spin" />
            Loading transcript...
          </div>
        ) : transcript.length === 0 ? (
          <p className="text-sm text-muted">No messages in this session.</p>
        ) : (
          <div className="space-y-2">
            {transcript.map((event) => (
              <motion.div
                key={event.id}
                variants={fadeUp}
                className={`rounded-xl p-3 text-sm ${
                  event.role === "user"
                    ? "bg-accent/10 text-foreground ml-8"
                    : "bg-card border border-border mr-8"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-bold text-xs uppercase">
                    {event.role === "user" ? "You" : "Assistant"}
                  </span>
                  <span className={`text-[0.6rem] font-bold px-1.5 py-0.5 rounded-full ${laneColors[event.lane] ?? ""}`}>
                    {event.lane}
                  </span>
                  <span className="text-[0.6rem] text-muted ml-auto">
                    {new Date(event.created_at).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })}
                  </span>
                </div>
                <p className="whitespace-pre-wrap leading-relaxed">{event.content}</p>
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>
    );
  }

  return (
    <motion.div
      className="max-w-3xl mx-auto p-4 md:p-8 space-y-6"
      initial="hidden"
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06 } } }}
    >
      <motion.div variants={fadeUp}>
        <h1
          className="text-[clamp(1.6rem,4vw,2.4rem)] font-[520] tracking-[-0.03em] leading-tight"
          style={{ fontFamily: "Georgia, 'Times New Roman', serif", color: "var(--ink-soft)" }}
        >
          Chat History
        </h1>
        <p className="mt-1 text-muted text-sm">
          View your past conversations with the assistant.
        </p>
      </motion.div>

      {error && (
        <div className="bg-danger/5 border border-danger/20 text-danger rounded-xl p-3 text-sm font-semibold flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-3 text-muted py-10">
          <Loader2 className="w-5 h-5 animate-spin" />
          Loading sessions...
        </div>
      ) : sessions.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl p-8 text-center">
          <MessageSquare className="w-8 h-8 text-muted mx-auto mb-3" />
          <p className="text-sm text-muted">No chat history found. Start a conversation from the FAQ or Scheduler.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sessions.map((session) => {
            const lanes = session.lane_summary;
            return (
              <motion.article
                key={session.id}
                variants={fadeUp}
                className="bg-card border border-border rounded-2xl overflow-hidden hover:border-accent/40 transition-colors cursor-pointer"
                onClick={() => openSession(session.id)}
              >
                <div className="p-4 flex items-center gap-3">
                  <MessageSquare className="w-5 h-5 text-accent shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">
                      {session.label || "Untitled session"}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-muted">{formatDate(session.last_activity_at)}</span>
                      <span className="text-[0.6rem] text-muted">
                        {lanes.rag > 0 && `${lanes.rag} FAQ`}
                        {lanes.rag > 0 && lanes.scheduler > 0 && " · "}
                        {lanes.scheduler > 0 && `${lanes.scheduler} Scheduler`}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); deleteSession(session.id); }}
                    disabled={deleting === session.id}
                    className="!bg-transparent !p-1.5 !text-muted hover:!text-danger !shadow-none shrink-0"
                    title="Delete session"
                  >
                    {deleting === session.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5" />
                    )}
                  </button>
                  <ChevronRight className="w-4 h-4 text-muted shrink-0" />
                </div>
              </motion.article>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}
