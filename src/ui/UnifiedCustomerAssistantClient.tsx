"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AssistantSessionEventRow } from "@/adapters/supabase/assistant-history-repository";
import { SchedulerOutput, SchedulerSessionContext, SlotOption } from "@/services/scheduler/types";
import { useAssistantHistory, type AssistantHistorySessionSummary } from "@/ui/useAssistantHistory";

type Citation = {
  source_url: string | null;
  source_id: string;
  source_title: string;
  last_checked: string;
  content_type: string;
};

type FaqResponse = {
  answer: string;
  citations: Citation[];
  status: "answered" | "refused" | "no_results" | "fund_mismatch";
  health_error?: string;
  pii_masked?: boolean;
  resolved_fund?: string | null;
  suggested_fund?: string | null;
  suggested_funds?: string[];
};

type AssistantMessage = {
  id: string;
  role: "assistant" | "user";
  lane: "assistant" | "rag" | "scheduler";
  text: string;
  citations?: Citation[];
  slots?: SlotOption[];
  secureLink?: string;
  myBookingsRedirect?: boolean;
  /** Internal status from API — hidden for answered to reduce noise */
  status?: string;
  /** When the query mentions funds not in the user's selection */
  suggestedFunds?: string[];
  /** User must choose before calling FAQ vs scheduler APIs */
  handoffKind?: "scheduler" | "dual";
  handoffPayload?: string;
};

type FundCatalogEntry = {
  scheme_name: string;
};

const schedulerStates = new Set([
  "topic_collection",
  "topic_collection_optional",
  "time_collection",
  "booking_code_collection",
  "slot_selection",
  "offer_waitlist",
  "confirmation",
  "cancellation_confirm"
]);

/**
 * Strips the "HDFC " prefix and trailing "Direct …" suffix for display
 * in compact pill / chip contexts.
 */
/**
 * Lightweight markdown-to-JSX renderer for chat messages.
 * Supports: **bold**, *italic*, `code`, bullet lists (* / -), URLs.
 */
function renderMarkdown(text: string): JSX.Element {
  const lines = text.split("\n");
  const elements: JSX.Element[] = [];
  let listItems: JSX.Element[] = [];
  let key = 0;

  function flushList() {
    if (listItems.length > 0) {
      elements.push(<ul key={key++} className="md-list">{listItems}</ul>);
      listItems = [];
    }
  }

  function inlineFormat(line: string): (string | JSX.Element)[] {
    const tokens: (string | JSX.Element)[] = [];
    const re = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|\[([^\]]+)\]\(([^)]+)\)|(https?:\/\/[^\s),]+))/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      if (m.index > last) tokens.push(line.slice(last, m.index));
      if (m[2]) tokens.push(<strong key={`i${key++}`}>{m[2]}</strong>);
      else if (m[3]) tokens.push(<em key={`i${key++}`}>{m[3]}</em>);
      else if (m[4]) tokens.push(<code key={`i${key++}`} className="md-code">{m[4]}</code>);
      else if (m[5] && m[6]) tokens.push(<a key={`i${key++}`} href={m[6]} className="inline-link">{m[5]}</a>);
      else if (m[7]) tokens.push(<a key={`i${key++}`} href={m[7]} target="_blank" rel="noreferrer" className="inline-link">{m[7]}</a>);
      last = m.index + m[0].length;
    }
    if (last < line.length) tokens.push(line.slice(last));
    return tokens;
  }

  let tableRows: string[][] = [];
  let tableAligns: string[] = [];

  function flushTable() {
    if (tableRows.length === 0) return;
    const header = tableRows[0];
    const body = tableRows.slice(1);
    elements.push(
      <div key={key++} className="md-table-wrap">
        <table className="md-table">
          <thead>
            <tr>
              {header.map((cell, ci) => (
                <th key={ci} style={tableAligns[ci] === "right" ? { textAlign: "right" } : tableAligns[ci] === "center" ? { textAlign: "center" } : undefined}>
                  {inlineFormat(cell)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci} style={tableAligns[ci] === "right" ? { textAlign: "right" } : tableAligns[ci] === "center" ? { textAlign: "center" } : undefined}>
                    {inlineFormat(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
    tableRows = [];
    tableAligns = [];
  }

  for (const line of lines) {
    const trimmed = line.trim();
    const isTableRow = trimmed.startsWith("|") && trimmed.endsWith("|");
    const isSeparator = isTableRow && /^\|[\s:\-|]+\|$/.test(trimmed);

    if (isTableRow) {
      flushList();
      if (isSeparator) {
        tableAligns = trimmed.split("|").filter(Boolean).map((cell) => {
          const c = cell.trim();
          if (c.startsWith(":") && c.endsWith(":")) return "center";
          if (c.endsWith(":")) return "right";
          return "left";
        });
      } else {
        const cells = trimmed.split("|").filter(Boolean).map((c) => c.trim());
        tableRows.push(cells);
      }
    } else {
      flushTable();
      const bullet = line.match(/^\s*[*\-]\s+(.*)/);
      if (bullet) {
        listItems.push(<li key={key++}>{inlineFormat(bullet[1])}</li>);
      } else {
        flushList();
        if (trimmed === "") {
          elements.push(<br key={key++} />);
        } else if (trimmed.startsWith("###")) {
          elements.push(<strong key={key++} className="md-heading">{inlineFormat(trimmed.replace(/^#+\s*/, ""))}</strong>);
        } else {
          elements.push(<span key={key++} className="md-line">{inlineFormat(line)}</span>);
        }
      }
    }
  }
  flushTable();
  flushList();

  return <>{elements}</>;
}

function shortFundName(fullName: string): string {
  return fullName
    .replace(/^HDFC\s+/i, "")
    .replace(/\s+(Direct\s+)?(Plan\s+)?(Growth\s+)?(Option)?\s*$/i, "")
    .trim();
}

function createWelcomeMessage(): AssistantMessage {
  return {
    id: "welcome",
    role: "assistant",
    lane: "assistant",
    text:
      "Welcome! You can ask about any approved mutual fund scheme\u2014exit loads, fees, holdings, NAV, and more\u2014or use Speak to an Advisor on the left to book, reschedule, cancel, or prepare for a call. Informal names like \"HDFC Defence fund\" work fine. To keep you safe, please avoid sharing personal identifiers in this chat."
  };
}

function eventsToAssistantMessages(events: AssistantSessionEventRow[]): AssistantMessage[] {
  return events.map((ev, index) => {
    const row: AssistantMessage = {
      id: typeof ev.id === "string" && ev.id ? ev.id : `hist-${index}`,
      role: ev.role,
      lane: ev.lane,
      text: ev.content,
      status: ev.status ?? undefined
    };

    if (ev.kind === "booking_link_issued") {
      row.text =
        "A secure booking link was shared in this chat. If you need a new one, please start a fresh session from Speak to an Advisor\u2014happy to help.";
    }

    if (ev.citations && Array.isArray(ev.citations)) {
      row.citations = ev.citations as Citation[];
    }
    if (ev.slots && Array.isArray(ev.slots)) {
      row.slots = (ev.slots as { id: string; label: string }[]).map((slot) => ({
        id: slot.id,
        label: slot.label,
        start_time: "",
        end_time: ""
      }));
    }

    return row;
  });
}


const UNIFIED_CHAT_STORAGE_KEY = "groww-unified:chat-state";

function saveUnifiedChatToSession(msgs: AssistantMessage[], ctx: SchedulerSessionContext | undefined) {
  try {
    sessionStorage.setItem(UNIFIED_CHAT_STORAGE_KEY, JSON.stringify({ messages: msgs, context: ctx }));
  } catch { /* private mode */ }
}

function loadUnifiedChatFromSession(): { messages: AssistantMessage[]; context: SchedulerSessionContext | undefined } | null {
  try {
    const raw = sessionStorage.getItem(UNIFIED_CHAT_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as { messages?: AssistantMessage[]; context?: SchedulerSessionContext };
    if (data.messages?.length) {
      return { messages: data.messages, context: data.context };
    }
  } catch { /* ignore */ }
  return null;
}

export function UnifiedCustomerAssistantClient() {
  const history = useAssistantHistory();
  const [messages, setMessages] = useState<AssistantMessage[]>(() => {
    if (typeof window !== "undefined") {
      const cached = loadUnifiedChatFromSession();
      if (cached) return cached.messages;
    }
    return [createWelcomeMessage()];
  });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySessions, setHistorySessions] = useState<AssistantHistorySessionSummary[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [viewingReadonly, setViewingReadonly] = useState(false);
  const liveMessagesRef = useRef<AssistantMessage[]>([]);
  const liveSchedulerRef = useRef<SchedulerSessionContext | undefined>();
  const readonlySourceSessionIdRef = useRef<string | null>(null);
  const [schedulerContext, setSchedulerContext] = useState<SchedulerSessionContext | undefined>(() => {
    if (typeof window !== "undefined") {
      const cached = loadUnifiedChatFromSession();
      if (cached) return cached.context;
    }
    return undefined;
  });
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fundCatalog, setFundCatalog] = useState<FundCatalogEntry[]>([]);
  const [selectedFunds, setSelectedFunds] = useState<Set<string>>(new Set());
  const [filterBarOpen, setFilterBarOpen] = useState(true);
  const lastInputWasVoiceRef = useRef(false);
  const [showAdvisorToast, setShowAdvisorToast] = useState(false);
  const advisorToastShownRef = useRef(false);
  const [trendingThemes, setTrendingThemes] = useState<string[]>([]);

  useEffect(() => {
    if (messages.length > 0) {
      saveUnifiedChatToSession(messages, schedulerContext);
    }
  }, [messages, schedulerContext]);

  const activeScheduler = useMemo(
    () =>
      Boolean(
        schedulerContext &&
          (schedulerStates.has(schedulerContext.state) || schedulerContext.slots_offered?.length)
      ),
    [schedulerContext]
  );

  const activeSchedulerRef = useRef(activeScheduler);
  useEffect(() => { activeSchedulerRef.current = activeScheduler; }, [activeScheduler]);

  const handleVoiceTurnResult = useCallback((result: VoiceTurnResult) => {
    lastInputWasVoiceRef.current = true;

    appendMessage({ role: "user", lane: "assistant", text: result.transcript });
    history.appendEvent({
      role: "user",
      lane: "assistant",
      kind: activeSchedulerRef.current ? "scheduler_in" : "faq_question",
      content: result.transcript
    });

    setSchedulerContext(result.context);
    const schedLabel = result.pii_warning ? "Details redacted" : undefined;
    appendMessage({
      role: "assistant",
      lane: "scheduler",
      text: result.response_text,
      slots: result.slots_offered,
      secureLink: result.secure_link,
      status: schedLabel
    });
    history.appendEvent({
      role: "assistant",
      lane: "scheduler",
      kind: "scheduler_out",
      content: result.response_text,
      scheduler_state: result.context.state,
      slots: result.slots_offered?.map((s) => ({ id: s.id, label: s.label })),
      status: schedLabel,
      booking_code: result.booking_code ?? result.context.booking_code
    });

    playTtsAudio(result.tts_audio_base64, result.tts_content_type, result.tts_text);

    if (result.secure_link) {
      appendMessage({
        role: "assistant",
        lane: "scheduler",
        text: "Your booking request has been captured. Finish the secure form from the link (personal details stay out of chat). Admin review follows before confirmation."
      });
      history.appendEvent({
        role: "assistant",
        lane: "scheduler",
        kind: "booking_link_issued",
        content: JSON.stringify({ issued: true })
      });
    } else if (result.my_bookings_redirect) {
      appendMessage({
        role: "assistant",
        lane: "scheduler",
        text: "Your booking request has been captured. Head to My Bookings to complete your personal details. Admin review follows before confirmation.",
        myBookingsRedirect: true
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const voice = useVoiceInput({
    schedulerContext,
    onResult: handleVoiceTurnResult,
    onError: (msg) => setError(msg),
    onRecordingChange: (recording) => {
      if (recording) setError(null);
    }
  });

  useEffect(() => {
    if (activeScheduler && !advisorToastShownRef.current) {
      advisorToastShownRef.current = true;
      setShowAdvisorToast(true);
      const timer = setTimeout(() => setShowAdvisorToast(false), 5000);
      return () => clearTimeout(timer);
    }
  }, [activeScheduler]);

  useEffect(() => {
    if (activeScheduler && trendingThemes.length === 0) {
      fetch("/api/admin/review-pulse")
        .then((r) => r.json())
        .then((d) => {
          if (d.pulse?.top_customer_themes) setTrendingThemes(d.pulse.top_customer_themes);
        })
        .catch(() => {});
    }
  }, [activeScheduler, trendingThemes.length]);

  useEffect(() => {
    fetch("/api/smart-sync-faq/funds")
      .then((r) => r.json())
      .then((d: { funds?: FundCatalogEntry[] }) => {
        if (Array.isArray(d.funds)) {
          setFundCatalog(d.funds);
        }
      })
      .catch(() => {});
  }, []);

  async function refreshHistoryList() {
    setHistoryBusy(true);
    try {
      const rows = await history.listSessions();
      setHistorySessions(rows);
    } catch {
      setHistorySessions([]);
    } finally {
      setHistoryBusy(false);
    }
  }

  async function openHistorySession(sessionId: string) {
    if (!viewingReadonly) {
      liveMessagesRef.current = messages;
      liveSchedulerRef.current = schedulerContext;
    }
    setHistoryBusy(true);
    try {
      const events = await history.loadSessionTranscript(sessionId);
      setSchedulerContext(undefined);
      setMessages(eventsToAssistantMessages(events));
      setViewingReadonly(true);
      readonlySourceSessionIdRef.current = sessionId;
      setHistoryOpen(false);
    } catch {
      /* ignore */
    } finally {
      setHistoryBusy(false);
    }
  }

  function backToCurrentChat() {
    setMessages(liveMessagesRef.current);
    setSchedulerContext(liveSchedulerRef.current);
    setViewingReadonly(false);
    readonlySourceSessionIdRef.current = null;
  }

  function continueFromHistoryPoint() {
    const prior = readonlySourceSessionIdRef.current;
    history.startNewSession();
    setSchedulerContext(undefined);
    setViewingReadonly(false);
    readonlySourceSessionIdRef.current = null;
    setError(null);
    setSelectedFunds(new Set());
    setMessages([
      {
        id: `resume-${Date.now()}`,
        role: "assistant",
        lane: "assistant",
        text: prior
          ? `Continuing from a previous chat (reference id: ${prior}). Ask a new question or use Speak to an Advisor when you are ready.`
          : "New chat \u2014 ask a question or use Speak to an Advisor when you are ready."
      }
    ]);
  }

  function toolbarNewChat() {
    history.startNewSession();
    setSchedulerContext(undefined);
    setViewingReadonly(false);
    readonlySourceSessionIdRef.current = null;
    liveMessagesRef.current = [];
    setError(null);
    setMessages([createWelcomeMessage()]);
    setSelectedFunds(new Set());
    setHistoryOpen(false);
    try { sessionStorage.removeItem(UNIFIED_CHAT_STORAGE_KEY); } catch { /* ignore */ }
  }

  async function deleteHistorySession(sessionId: string) {
    await history.deleteSessionRemote(sessionId);
    await refreshHistoryList();
    if (viewingReadonly && readonlySourceSessionIdRef.current === sessionId) {
      backToCurrentChat();
    }
  }

  async function clearAllHistorySessions() {
    if (!window.confirm("Delete all saved chat history on this server for this device?")) {
      return;
    }
    await history.clearAllRemote();
    await refreshHistoryList();
    if (viewingReadonly) {
      backToCurrentChat();
    }
  }

  async function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (viewingReadonly) {
      return;
    }
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    await routeMessage(trimmed);
    setText("");
  }

  async function routeMessage(rawText: string, displayText?: string) {
    if (viewingReadonly) {
      return;
    }
    const trimmed = rawText.trim();
    if (!trimmed || loading) {
      return;
    }
    const effectiveText = trimmed;
    const shown = (displayText ?? rawText).trim() || effectiveText;

    setError(null);
    appendMessage({
      role: "user",
      lane: "assistant",
      text: shown
    });
    history.appendEvent({
      role: "user",
      lane: "assistant",
      kind: activeScheduler ? "scheduler_in" : "faq_question",
      content: shown
    });
    setLoading(true);

    try {
      const isFaq = looksLikeFaqIntent(effectiveText);
      const isScheduler = looksLikeSchedulerIntent(effectiveText);
      const isExitToFaq = looksLikeSchedulerExitToFaq(effectiveText);

      if (isExitToFaq && activeScheduler) {
        setSchedulerContext(undefined);
        if (looksLikeFaqIntent(effectiveText) || /\b(question|faq|fund|scheme|fee|nav)\b/i.test(effectiveText)) {
          await sendFaqQuestion(effectiveText);
        } else {
          appendMessage({
            role: "assistant",
            lane: "assistant",
            text: "Exited advisor session. Use the question box whenever you’re ready."
          });
        }
      } else if (activeScheduler) {
        if (isFaq && !isScheduler) {
          await sendFaqQuestion(effectiveText);
        } else {
          await sendSchedulerMessage(effectiveText);
        }
      } else if (looksLikeConversationalOnly(trimmed)) {
        const reply = conversationalReplyText(trimmed);
        appendMessage({
          role: "assistant",
          lane: "assistant",
          text: reply
        });
        history.appendEvent({
          role: "assistant",
          lane: "assistant",
          kind: "greeting",
          content: reply
        });
      } else if (isScheduler) {
        await sendSchedulerMessage(effectiveText);
      } else {
        await sendFaqQuestion(effectiveText);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Assistant request failed.");
    } finally {
      setLoading(false);
    }
  }

  function appendBookingHandoffMessage(
    preamble: string,
    payload: string,
    kind: "scheduler" | "dual"
  ) {
    const tail =
      kind === "dual"
        ? " How would you like to continue?"
        : " Switch to advisor session with what you typed, or stay here for fund facts.";
    appendMessage({
      role: "assistant",
      lane: "assistant",
      text: `${preamble}${tail}`,
      handoffKind: kind,
      handoffPayload: payload
    });
    history.appendEvent({
      role: "assistant",
      lane: "assistant",
      kind: "handoff_prompt",
      content: `${preamble}${tail}`
    });
  }

  async function handoffProceedFaq(payload: string | undefined) {
    if (viewingReadonly) {
      return;
    }
    if (!payload?.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await sendFaqQuestion(payload.trim());
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Assistant request failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handoffProceedScheduler(payload: string | undefined) {
    if (viewingReadonly) {
      return;
    }
    if (!payload?.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await sendSchedulerMessage(payload.trim());
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Assistant request failed.");
    } finally {
      setLoading(false);
    }
  }

  function handoffStayOnFaq() {
    if (viewingReadonly) {
      return;
    }
    appendMessage({
      role: "assistant",
      lane: "assistant",
      text: "Staying in fund Q&A — ask about schemes, charges, holdings, or statements. Just type the fund name naturally."
    });
  }

  async function sendFaqQuestion(question: string) {
    const fundsToSend = Array.from(selectedFunds);

    const historyTurns = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .filter((m) => m.id !== "welcome")
      .slice(-6)
      .map((m) => ({ role: m.role, text: m.text }));

    const result = await fetch("/api/smart-sync-faq", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question,
        selected_funds: fundsToSend,
        history: historyTurns
      })
    });

    const data = (await result.json()) as FaqResponse | { error: string };
    if ("error" in data) {
      throw new Error(data.error);
    }
    if (!result.ok && !("status" in data && "answer" in data)) {
      throw new Error("FAQ request failed.");
    }

    const ragStatusLabel = formatRagStatus(data.status, selectedFunds.size, data.health_error);

    appendMessage({
      role: "assistant",
      lane: "rag",
      text: data.answer,
      citations: data.status === "answered" && !/not enough information/i.test(data.answer)
        ? data.citations : [],
      status:
        ragStatusLabel && data.pii_masked ? `${ragStatusLabel} · details redacted` : ragStatusLabel,
      suggestedFunds: data.status === "fund_mismatch"
        ? (data.suggested_funds ?? (data.suggested_fund ? [data.suggested_fund] : undefined))
        : undefined
    });
    history.appendEvent({
      role: "assistant",
      lane: "rag",
      kind: "faq_answer",
      content: data.answer,
      citations: data.citations,
      status:
        ragStatusLabel && data.pii_masked ? `${ragStatusLabel} · details redacted` : ragStatusLabel
    });
  }

  async function sendSchedulerMessage(messageText: string) {
    let currentContext = schedulerContext;

    if (!currentContext) {
      const greetRes = await fetch("/api/scheduler/message?mode=chat");
      if (greetRes.ok) {
        const greeting = (await greetRes.json()) as SchedulerOutput & { tts_audio_base64?: string | null; tts_content_type?: string; tts_text?: string };
        currentContext = greeting.context;
        setSchedulerContext(currentContext);
        appendMessage({
          role: "assistant",
          lane: "scheduler",
          text: greeting.response_text
        });
        history.appendEvent({
          role: "assistant",
          lane: "scheduler",
          kind: "scheduler_out",
          content: greeting.response_text,
          scheduler_state: greeting.context.state
        });
        playTtsAudio(greeting.tts_audio_base64 ?? null, greeting.tts_content_type ?? "audio/mpeg", greeting.tts_text ?? greeting.response_text);
      }
    }

    const response = await fetch("/api/scheduler/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: messageText,
        input_mode: "chat",
        context: currentContext
      })
    });
    const data = (await response.json()) as SchedulerOutput & { error?: string };
    if (!response.ok) {
      throw new Error(data.error ?? "Scheduler request failed.");
    }

    setSchedulerContext(data.context);
    const schedLabel = data.pii_warning ? "Details redacted" : undefined;

    appendMessage({
      role: "assistant",
      lane: "scheduler",
      text: data.response_text,
      slots: data.slots_offered,
      secureLink: data.secure_link,
      status: schedLabel
    });

    history.appendEvent({
      role: "assistant",
      lane: "scheduler",
      kind: "scheduler_out",
      content: data.response_text,
      scheduler_state: data.context.state,
      slots: data.slots_offered?.map((s) => ({ id: s.id, label: s.label })),
      status: schedLabel,
      booking_code: data.booking_code ?? data.context.booking_code
    });

    if (data.secure_link) {
      appendMessage({
        role: "assistant",
        lane: "scheduler",
        text: "Your booking request has been captured. Finish the secure form from the link (personal details stay out of chat). Admin review follows before confirmation."
      });
      history.appendEvent({
        role: "assistant",
        lane: "scheduler",
        kind: "booking_link_issued",
        content: JSON.stringify({ issued: true })
      });
      history.appendEvent({
        role: "assistant",
        lane: "scheduler",
        kind: "scheduler_out",
        content:
          "Your booking request has been captured. Finish the secure form from the link (personal details stay out of chat). Admin review follows before confirmation."
      });
    } else if (data.my_bookings_redirect) {
      appendMessage({
        role: "assistant",
        lane: "scheduler",
        text: "Your booking request has been captured. Head to My Bookings to complete your personal details. Admin review follows before confirmation.",
        myBookingsRedirect: true
      });
    }
  }

  async function beginAdvisorBooking() {
    if (viewingReadonly) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const greetRes = await fetch("/api/scheduler/message?mode=chat");
      if (!greetRes.ok) throw new Error("Could not start advisor session.");
      const greeting = (await greetRes.json()) as SchedulerOutput & { tts_audio_base64?: string | null; tts_content_type?: string; tts_text?: string };
      setSchedulerContext(greeting.context);
      appendMessage({
        role: "assistant",
        lane: "scheduler",
        text: greeting.response_text
      });
      history.appendEvent({
        role: "assistant",
        lane: "scheduler",
        kind: "scheduler_out",
        content: greeting.response_text,
        scheduler_state: greeting.context.state
      });
      playTtsAudio(greeting.tts_audio_base64 ?? null, greeting.tts_content_type ?? "audio/mpeg", greeting.tts_text ?? greeting.response_text);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Assistant request failed.");
    } finally {
      setLoading(false);
    }
  }

  function appendMessage(message: Omit<AssistantMessage, "id">) {
    setMessages((current) => [
      ...current,
      {
        ...message,
        id: `${Date.now()}-${current.length}`
      }
    ]);
  }

  function clearSchedulerBackToFaq() {
    if (viewingReadonly) {
      return;
    }
    setSchedulerContext(undefined);
    appendMessage({
      role: "assistant",
      lane: "assistant",
      text: "Back to mutual fund questions. Type in the search box whenever you're ready."
    });
  }

  return (
    <section className="unified-assistant unified-assistant--refined">
      <div className="assistant-workspace">
        <aside className="assistant-booking-column">
          <div className="booking-card">
            <span>Advisor</span>
            <h2>Speak to an Advisor</h2>
            <p>
              Book, reschedule, cancel, check availability, or prepare for a call — without sharing
              identifiers here.
            </p>
            <button
              type="button"
              className="booking-card-primary"
              disabled={loading || viewingReadonly}
              onClick={() => beginAdvisorBooking()}
            >
              Speak to an Advisor
            </button>
            {activeScheduler ? (
              <button
                type="button"
                className="secondary booking-card-secondary"
                disabled={viewingReadonly}
                onClick={clearSchedulerBackToFaq}
              >
                Back to fund search
              </button>
            ) : null}
          </div>
          <details className="booking-card booking-card-soft">
            <summary>How bookings work</summary>
            <p>
              Conversation stays high level; secure details happen on a separate form. Responses use your
              Google-linked ops workflow (calendar hold, draft email, approvals).
            </p>
          </details>
        </aside>

        <div className="assistant-faq-column">
          <div className="faq-head faq-head-with-toolbar">
            <div className="faq-head-main">
              <div>
                <span>Approved schemes</span>
                <h2>Ask about mutual fund facts</h2>
              </div>
              <p className="faq-head-note">
                14 official scheme pages plus fee guides — citations when we have a match. Not for investment picks or live account support.
              </p>
              <span
                className="faq-head-disclaimer"
                aria-label="Disclaimer"
                title="This assistant only returns facts from approved sources."
              >
                Facts-only. No investment advice.
              </span>
              {!viewingReadonly && !activeScheduler ? (
                <div className="faq-head-examples" role="group" aria-label="Example questions">
                  <span className="faq-head-examples-label">Try:</span>
                  {[
                    "Expense ratio of HDFC Defence Fund?",
                    "Why is exit load charged?",
                    "What is the benchmark for HDFC Mid-Cap Fund?"
                  ].map((example) => (
                    <button
                      key={example}
                      type="button"
                      className="faq-head-example-chip"
                      disabled={loading}
                      onClick={() => setText(example)}
                    >
                      {example}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="faq-head-toolbar" role="group" aria-label="Chat actions">
              <button
                type="button"
                className="secondary faq-head-tool"
                onClick={() => {
                  setHistoryOpen(true);
                  void refreshHistoryList();
                }}
              >
                History
              </button>
              <button type="button" className="secondary faq-head-tool" onClick={toolbarNewChat}>
                New chat
              </button>
            </div>
          </div>

          {viewingReadonly ? (
            <div className="assistant-readonly-bar" role="status">
              <span className="message-status-pill">Read-only past chat</span>
              <button type="button" onClick={continueFromHistoryPoint}>
                Continue from this point
              </button>
              <button type="button" className="secondary" onClick={backToCurrentChat}>
                Back to current chat
              </button>
            </div>
          ) : null}

          {activeScheduler ? (
            <>
              <p className="faq-mode-hint">
                Advisor session is active. Use the replies below, or tap Back to fund search when you need
                Q&amp;A again.
              </p>
              {trendingThemes.length > 0 ? (
                <div className="theme-greeting-banner">
                  <span className="theme-greeting-banner-label">Trending this week:</span>
                  {trendingThemes.map((t) => (
                    <span key={t} className="theme-greeting-banner-pill">{t}</span>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}

          <div className={`assistant-thread${viewingReadonly ? " assistant-thread--readonly" : ""}`} aria-live="polite">
            {messages.map((message) => (
              <article className={`assistant-message ${message.role}`} key={message.id}>
                <div className="message-meta">
                  <strong>{message.role === "assistant" ? laneLabel(message.lane) : "You"}</strong>
                  {message.status ? <span className="message-status-pill">{message.status}</span> : null}
                </div>
                <div className={`message-body${
                  (message.suggestedFunds && message.suggestedFunds.length > 0) || message.text.startsWith("Please select at least one fund")
                    ? " fund-selection-warning"
                    : ""
                }`}>{renderMarkdown(message.text)}</div>

                {message.handoffKind && message.handoffPayload ? (
                  <div className="handoff-actions" role="group" aria-label="Choose next step">
                    {message.handoffKind === "dual" ? (
                      <>
                        <button
                          type="button"
                          disabled={loading || viewingReadonly}
                          onClick={() => handoffProceedFaq(message.handoffPayload)}
                        >
                          Search sources first
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          disabled={loading || viewingReadonly}
                          onClick={() => handoffProceedScheduler(message.handoffPayload)}
                        >
                          Speak to an Advisor
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={loading || viewingReadonly}
                          onClick={() => handoffProceedScheduler(message.handoffPayload)}
                        >
                          Yes, open booking
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          disabled={loading || viewingReadonly}
                          onClick={handoffStayOnFaq}
                        >
                          No, stay in Q&A
                        </button>
                      </>
                    )}
                  </div>
                ) : null}

                {message.slots?.length ? (
                  <div className="slot-card-grid" aria-label="Advisor slot options">
                    {message.slots.map((slot) => (
                      <button
                        type="button"
                        className="slot-card"
                        key={slot.id}
                        disabled={viewingReadonly}
                        onClick={() => routeMessage(slot.id, `Slot ${slot.id}: ${slot.label}`)}
                      >
                        <span>Option {slot.id}</span>
                        <strong>{slot.label}</strong>
                      </button>
                    ))}
                  </div>
                ) : null}

                {message.secureLink ? (
                  <a className="secure-link-card" href={message.secureLink} target="_blank" rel="noreferrer">
                    Open secure details form
                  </a>
                ) : null}

                {message.myBookingsRedirect ? (
                  <a className="secure-link-card" href="/customer/my-bookings">
                    Go to My Bookings
                  </a>
                ) : null}

                {message.suggestedFunds && message.suggestedFunds.length > 0 ? (
                  <div className="fund-chips fund-chips-inline" aria-label="Add fund to selection">
                    {message.suggestedFunds.map((fund) => (
                      <button
                        key={fund}
                        type="button"
                        className="fund-chip"
                        disabled={viewingReadonly}
                        onClick={() => {
                          setSelectedFunds((prev) => new Set([...prev, fund]));
                        }}
                      >
                        Add {shortFundName(fund)} to selection
                      </button>
                    ))}
                  </div>
                ) : null}

                {message.citations?.length ? (
                  <div className="citation-grid">
                    {message.citations.map((citation) => (
                      <article className="citation-card" key={`${message.id}-${citation.source_id}`}>
                        <strong>{citation.source_title}</strong>
                        <span>Checked {citation.last_checked}</span>
                        {citation.source_url ? (
                          <a href={citation.source_url} target="_blank" rel="noreferrer">
                            Source
                          </a>
                        ) : null}
                      </article>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
            {loading ? <p className="muted">Working…</p> : null}
          </div>

          {error ? <p className="error-banner">{error}</p> : null}

          <div
            className={`assistant-mode-badge${activeScheduler ? " assistant-mode-badge--advisor" : ""}`}
            role="status"
          >
            {viewingReadonly
              ? "Read-only past chat"
              : activeScheduler
                ? "Advisor session"
                : "Fund Q\u00A0&\u00A0A"}
          </div>

          {showAdvisorToast && voice.supported ? (
            <div className="assistant-mode-toast" role="status">
              Hold the mic button to speak your replies
            </div>
          ) : null}

          <form className="faq-search-form" onSubmit={submitMessage}>
            <label htmlFor="faq-search-input">Question</label>
            <div className="faq-search-row">
              <input
                id="faq-search-input"
                type="search"
                name="faq-search"
                enterKeyHint={activeScheduler ? "send" : "search"}
                value={text}
                onChange={(event) => {
                  lastInputWasVoiceRef.current = false;
                  setText(event.target.value);
                }}
                placeholder={
                  activeScheduler
                    ? "Type your reply or hold the mic\u2026"
                    : "Ask about a fund or use Speak to an Advisor\u2026"
                }
                disabled={loading || viewingReadonly}
                autoComplete="off"
              />
              {voice.supported && activeScheduler ? (
                <button
                  type="button"
                  className={`secondary faq-mic-button${voice.recording ? " faq-mic-button--listening" : ""}${voice.processing ? " faq-mic-button--processing" : ""}`}
                  aria-label={voice.recording ? "Release to send" : voice.processing ? "Processing voice\u2026" : "Hold to speak"}
                  title={voice.recording ? "Release to send" : voice.processing ? "Processing\u2026" : "Hold to speak"}
                  disabled={loading || viewingReadonly || voice.processing}
                  onPointerDown={(e) => { e.preventDefault(); voice.startRecording(); }}
                  onPointerUp={() => voice.stopRecording()}
                  onPointerLeave={() => { if (voice.recording) voice.stopRecording(); }}
                  onContextMenu={(e) => e.preventDefault()}
                >
                  {voice.processing ? <SpinnerIcon /> : <MicIcon />}
                </button>
              ) : null}
              <button
                type="submit"
                disabled={loading || viewingReadonly || !text.trim()}
              >
                {activeScheduler ? "Send" : "Ask"}
              </button>
            </div>

            {!activeScheduler && !viewingReadonly && fundCatalog.length > 0 ? (
              <FundFilterBar
                catalog={fundCatalog}
                selectedFunds={selectedFunds}
                isOpen={filterBarOpen}
                disabled={loading}
                onToggleOpen={() => setFilterBarOpen((v) => !v)}
                onToggleFund={(f) => setSelectedFunds((prev) => toggleSet(prev, f))}
                onSelectAll={() => setSelectedFunds(new Set(fundCatalog.map((f) => f.scheme_name)))}
                onDeselectAll={() => setSelectedFunds(new Set())}
              />
            ) : null}

          </form>
        </div>
      </div>

      {historyOpen ? (
        <>
          <button
            type="button"
            className="assistant-history-backdrop"
            aria-label="Close history"
            onClick={() => setHistoryOpen(false)}
          />
          <aside className="assistant-history-drawer" aria-labelledby="assistant-history-title">
            <header className="assistant-history-drawer-head">
              <h2 id="assistant-history-title">Chat history</h2>
              <button type="button" className="secondary" onClick={() => setHistoryOpen(false)}>
                Close
              </button>
            </header>
            <div className="assistant-history-body">
              {historyBusy && historySessions.length === 0 ? <p className="muted">Loading…</p> : null}
              {!historyBusy && historySessions.length === 0 ? (
                <p className="muted">No saved sessions yet.</p>
              ) : null}
              <ul className="assistant-history-list">
                {historySessions.map((session) => (
                  <li key={session.id} className="assistant-history-row">
                    <div>
                      <strong>{session.label?.trim() || "Conversation"}</strong>
                      <p className="assistant-history-meta">
                        Last activity: {formatHistoryTimestamp(session.last_activity_at)} · Sources{" "}
                        {session.lane_summary.rag}, Booking {session.lane_summary.scheduler}, Assistant{" "}
                        {session.lane_summary.assistant}
                      </p>
                    </div>
                    <div className="assistant-history-row-actions">
                      <button type="button" onClick={() => void openHistorySession(session.id)}>
                        Open
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => void deleteHistorySession(session.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <footer className="assistant-history-footer">
              <button type="button" onClick={toolbarNewChat}>
                New chat
              </button>
              <button type="button" className="secondary" onClick={() => void clearAllHistorySessions()}>
                Clear all
              </button>
            </footer>
          </aside>
        </>
      ) : null}
    </section>
  );
}

function formatHistoryTimestamp(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function formatRagStatus(
  status: "answered" | "refused" | "no_results" | "fund_mismatch",
  selectedFundCount?: number,
  healthError?: string
): string | undefined {
  if (status === "answered") return undefined;
  if (status === "refused") return undefined;
  if (status === "fund_mismatch") return "Fund not in your selection.";
  if (status === "no_results") {
    if (healthError && /429|quota|RESOURCE_EXHAUSTED|rate limit|Too Many Requests|temporarily unavailable|Model temporarily/i.test(healthError)) {
      return "AI quota or rate limit — retry shortly (not a missing source).";
    }
    if (selectedFundCount && selectedFundCount > 0) {
      return "I couldn't find a matching source for that question.";
    }
    return "I couldn't find a matching source yet; you could try rephrasing or selecting a fund from the filter bar below.";
  }
  return undefined;
}

/** Short social lines with no substantive question route here instead of RAG (avoid no_results noise). */
function looksLikeConversationalOnly(raw: string) {
  const n = normalizeConversationStub(raw);
  if (!n || n.length > 64) return false;
  if (looksLikeFaqIntent(raw) || looksLikeSchedulerIntent(raw)) return false;
  if (normalizeConversationStub(raw).split(/\s+/).length > 6) return false;

  const thanks = /^(thanks|thank you|thx|ty)(\s+(a lot|again|so much))?$/;
  const farewell =
    /^(bye|goodbye|cya|see\s+you|see\s+ya)(\s+(later|soon))?$/;
  const ack = /^(ok|okay|sure|cool|got it)(\s+(thanks|thank you))?$/;

  const greet =
    /^(hi|hello|hey|hiya|howdy)(\s+(there|team|groww|all))?$|^(good\s+(morning|afternoon|evening))$/;

  return greet.test(n) || thanks.test(n) || farewell.test(n) || ack.test(n);
}

function normalizeConversationStub(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^[!?.,;:]+/, "")
    .replace(/\s+/g, " ")
    .replace(/[!?.,;:]+$/, "")
    .trim();
}

function conversationalReplyText(raw: string) {
  const n = normalizeConversationStub(raw);
  if (/^(thanks|thank you|thx|ty)/.test(n)) {
    return "You're very welcome. Whenever you're ready, use the search box for fund questions or Speak to an Advisor on the left.";
  }
  if (/^(bye|goodbye|cya|see\s+you|see\s+ya)/.test(n)) {
    return "Goodbye, and thank you for stopping by. You're welcome back any time for scheme information or to speak with an advisor.";
  }
  if (/^(ok|okay|sure|cool|got it)/.test(n)) {
    return "Sounds good\u2014whenever you're ready, type your fund question below, or use Speak to an Advisor on the left.";
  }
  return "Hi there! For factual questions about the approved schemes, use the search box below, or use Speak to an Advisor on the left. For your privacy, please avoid sharing personal identifiers here.";
}

function looksLikeSchedulerIntent(input: string) {
  return /\b(book|booking|advisor|appointment|schedule|reschedule|cancel|availability|available|slot|prepare|speak to an advisor)\b/i.test(
    input
  );
}

function looksLikeFaqIntent(input: string) {
  return /\b(exit load|expense ratio|lock-?in|benchmark|riskometer|fee|fees|statement|tax|citation|nav\b|aum\b|holdings?|fund objective|investment objective|minimum sip|min sip|scheme|fund manager|returns?|ranking|stamp duty|about .+ fund|what is|tell me about|elss|sip\b|lump\s*sum|folio|stcg|ltcg|capital gains|dividend|idcw)\b/i.test(
    input
  );
}

/** Phrases that leave advisor booking for Q&A. Avoid lone "cancel" — scheduler uses it for appointment cancel. */
function looksLikeSchedulerExitToFaq(input: string) {
  const t = input.toLowerCase();
  return (
    /\bnever\s*mind\b/.test(t) ||
    /\b(i\s+)?have\s+a\s+(different\s+)?question\b/.test(t) ||
    /\bswitch\s+to\s+(faq|questions?)\b/.test(t) ||
    /\b(go|get)\s+back\s+to\s+(faq|fund|questions?|search)\b/.test(t) ||
    /\b(back\s+to)\s+(faq|fund|questions?)\b/.test(t) ||
    /\b(stop|quit)\s+(the\s+)?(booking|scheduling)(\s+(flow))?\b/.test(t)
  );
}

function laneLabel(lane: AssistantMessage["lane"]) {
  if (lane === "rag") {
    return "Sources";
  }
  if (lane === "scheduler") {
    return "Booking";
  }
  return "Assistant";
}

// ─── Voice types & helpers ──────────────────────────────────────────────────

type VoiceTurnResult = {
  transcript: string;
  stt_confidence: number;
  response_text: string;
  tts_text: string;
  tts_audio_base64: string | null;
  tts_content_type: string;
  next_state: string;
  context: SchedulerSessionContext;
  booking_code?: string;
  slots_offered?: SlotOption[];
  secure_link?: string;
  my_bookings_redirect?: boolean;
  pii_warning?: boolean;
};

type UseVoiceInputOptions = {
  schedulerContext: SchedulerSessionContext | undefined;
  onResult: (result: VoiceTurnResult) => void;
  onError: (message: string) => void;
  onRecordingChange?: (recording: boolean) => void;
};

function hasMediaRecorder(): boolean {
  return typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && typeof navigator?.mediaDevices?.getUserMedia === "function";
}

type WebSpeechRecognitionResult = { transcript: string; confidence: number };
type WebSpeechRecognitionResultList = { [index: number]: { [index: number]: WebSpeechRecognitionResult }; length: number };
type WebSpeechRecognitionEvent = Event & { results: WebSpeechRecognitionResultList };
type WebSpeechRecognition = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  onresult: ((event: WebSpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};
type WebSpeechRecognitionConstructor = { new(): WebSpeechRecognition };
type WindowWithSpeech = Window & {
  SpeechRecognition?: WebSpeechRecognitionConstructor;
  webkitSpeechRecognition?: WebSpeechRecognitionConstructor;
};

function getSpeechRecognitionApi(): WebSpeechRecognitionConstructor | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as WindowWithSpeech;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

let pendingGreetingAudio: { base64: string | null; contentType: string; fallbackText?: string } | null = null;
let greetingListenerAttached = false;

function drainPendingGreeting() {
  if (!pendingGreetingAudio) return;
  const { base64, contentType, fallbackText } = pendingGreetingAudio;
  pendingGreetingAudio = null;
  playTtsAudioImmediate(base64, contentType, fallbackText);
}

function playTtsAudio(base64: string | null, contentType: string, fallbackText?: string) {
  if (typeof window === "undefined") return;
  playTtsAudioImmediate(base64, contentType, fallbackText);
}

function playTtsAudioImmediate(base64: string | null, contentType: string, fallbackText?: string) {
  if (typeof window === "undefined") return;

  if (base64) {
    try {
      const audio = new Audio(`data:${contentType};base64,${base64}`);
      audio.play().catch(() => speakWithBrowserFallback(fallbackText));
      return;
    } catch {
      // fall through to browser fallback
    }
  }

  speakWithBrowserFallback(fallbackText);
}

function playTtsAudioOrDefer(base64: string | null, contentType: string, fallbackText?: string) {
  if (typeof window === "undefined") return;

  if (base64) {
    try {
      const audio = new Audio(`data:${contentType};base64,${base64}`);
      const promise = audio.play();
      if (promise) {
        promise.catch(() => {
          pendingGreetingAudio = { base64, contentType, fallbackText };
          if (!greetingListenerAttached) {
            greetingListenerAttached = true;
            const handler = () => {
              drainPendingGreeting();
              document.removeEventListener("click", handler);
              document.removeEventListener("keydown", handler);
              document.removeEventListener("touchstart", handler);
            };
            document.addEventListener("click", handler, { once: false });
            document.addEventListener("keydown", handler, { once: false });
            document.addEventListener("touchstart", handler, { once: false });
          }
        });
      }
      return;
    } catch {
      // fall through
    }
  }

  try {
    speakWithBrowserFallback(fallbackText);
  } catch {
    pendingGreetingAudio = { base64, contentType, fallbackText };
  }
}

function speakWithBrowserFallback(text?: string) {
  if (!text || typeof window === "undefined" || !window.speechSynthesis) return;
  const cleaned = text.replace(/\n+/g, " ").trim();
  if (!cleaned) return;
  const utterance = new SpeechSynthesisUtterance(cleaned);
  utterance.lang = "en-IN";
  window.speechSynthesis.speak(utterance);
}

function useVoiceInput({ schedulerContext, onResult, onError, onRecordingChange }: UseVoiceInputOptions) {
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [supported, setSupported] = useState(false);
  const [useServerVoice, setUseServerVoice] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef(schedulerContext);

  useEffect(() => {
    contextRef.current = schedulerContext;
  }, [schedulerContext]);

  useEffect(() => {
    const server = hasMediaRecorder();
    const browser = Boolean(getSpeechRecognitionApi());
    setSupported(server || browser);
    setUseServerVoice(server);
  }, []);

  function startRecording() {
    if (recording || processing) return;

    if (!useServerVoice) {
      startBrowserStt();
      return;
    }

    setRecording(true);
    onRecordingChange?.(true);
    chunksRef.current = [];

    navigator.mediaDevices.getUserMedia({ audio: true })
      .then((stream) => {
        streamRef.current = stream;
        const mr = new MediaRecorder(stream, { mimeType: pickMimeType() });
        mediaRecorderRef.current = mr;
        mr.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };
        mr.onstop = () => sendVoiceTurn();
        mr.start();
      })
      .catch((err) => {
        setRecording(false);
        onRecordingChange?.(false);
        onError(err instanceof DOMException && err.name === "NotAllowedError"
          ? "Microphone access denied. Please allow microphone or use text input."
          : "Could not access microphone.");
      });
  }

  function stopRecording() {
    if (!recording) return;
    setRecording(false);
    onRecordingChange?.(false);

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  async function sendVoiceTurn() {
    if (chunksRef.current.length === 0) return;
    setProcessing(true);

    const blob = new Blob(chunksRef.current, { type: chunksRef.current[0].type });
    const formData = new FormData();
    formData.append("audio", blob, "recording.webm");
    if (contextRef.current) {
      formData.append("context", JSON.stringify(contextRef.current));
    }

    try {
      const res = await fetch("/api/scheduler/voice-turn", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        if (data.fallback_to_text) {
          onError("Voice recognition failed. Please type your message instead.");
        } else {
          onError(data.error ?? "Voice request failed.");
        }
        return;
      }
      if (!data.transcript?.trim()) {
        onError("I didn't catch that. Please hold the mic and speak clearly.");
        return;
      }
      onResult(data as VoiceTurnResult);
    } catch {
      onError("Voice request failed. Please try again or type your message.");
    } finally {
      setProcessing(false);
    }
  }

  function startBrowserStt() {
    const Api = getSpeechRecognitionApi();
    if (!Api) return;

    setRecording(true);
    onRecordingChange?.(true);
    const recognition = new Api();
    recognition.lang = "en-IN";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      if (transcript.trim()) {
        sendTextAsVoiceFallback(transcript);
      }
    };

    recognition.onend = () => {
      setRecording(false);
      onRecordingChange?.(false);
    };
    recognition.onerror = () => {
      setRecording(false);
      onRecordingChange?.(false);
    };

    recognition.start();
  }

  async function sendTextAsVoiceFallback(transcript: string) {
    setProcessing(true);
    try {
      const res = await fetch("/api/scheduler/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: transcript,
          input_mode: "voice",
          context: contextRef.current
        })
      });
      const data = await res.json();
      if (!res.ok) {
        onError(data.error ?? "Scheduler request failed.");
        return;
      }
      onResult({
        transcript,
        stt_confidence: 1,
        response_text: data.response_text,
        tts_text: data.response_text,
        tts_audio_base64: null,
        tts_content_type: "audio/mpeg",
        next_state: data.next_state,
        context: data.context,
        booking_code: data.booking_code,
        slots_offered: data.slots_offered,
        secure_link: data.secure_link,
        pii_warning: data.pii_warning
      });
    } catch {
      onError("Request failed. Please try again.");
    } finally {
      setProcessing(false);
    }
  }

  return { recording, processing, supported, useServerVoice, startRecording, stopRecording };
}

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "audio/webm";
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) return "audio/webm;codecs=opus";
  if (MediaRecorder.isTypeSupported("audio/webm")) return "audio/webm";
  if (MediaRecorder.isTypeSupported("audio/mp4")) return "audio/mp4";
  return "audio/webm";
}

const MicIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="9" y="2" width="6" height="12" rx="3" stroke="currentColor" strokeWidth="2" />
    <path d="M5 10a7 7 0 0014 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <line x1="12" y1="19" x2="12" y2="22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <line x1="9" y1="22" x2="15" y2="22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const SpinnerIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="voice-spinner">
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" opacity="0.3" />
    <path d="M12 2a10 10 0 019.8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

function toggleSet<T>(prev: Set<T>, value: T): Set<T> {
  const next = new Set(prev);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }
  return next;
}

type FundFilterBarProps = {
  catalog: FundCatalogEntry[];
  selectedFunds: Set<string>;
  isOpen: boolean;
  disabled: boolean;
  onToggleOpen: () => void;
  onToggleFund: (f: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
};

function FundFilterBar({
  catalog,
  selectedFunds,
  isOpen,
  disabled,
  onToggleOpen,
  onToggleFund,
  onSelectAll,
  onDeselectAll
}: FundFilterBarProps) {
  const allSelected = selectedFunds.size === catalog.length;

  return (
    <div className="faq-filter-bar">
      <div className="faq-filter-bar-header">
        <span className="faq-filter-bar-title">
          Funds
          <span className={`faq-filter-count${allSelected ? " faq-filter-count--muted" : ""}`}>
            {selectedFunds.size}/{catalog.length} selected
          </span>
        </span>
        <div className="faq-filter-bar-actions">
          <button
            type="button"
            className="faq-filter-clear"
            onClick={allSelected ? onDeselectAll : onSelectAll}
            disabled={disabled}
          >
            {allSelected ? "Deselect all" : "Select all"}
          </button>
          <button
            type="button"
            className="faq-filter-collapse"
            aria-label={isOpen ? "Collapse filter bar" : "Expand filter bar"}
            onClick={onToggleOpen}
          >
            {isOpen ? "▲" : "▼"}
          </button>
        </div>
      </div>

      {isOpen ? (
        <div className="faq-filter-rows">
          <div className="faq-filter-row">
            <div className="faq-filter-chips faq-filter-chips--full-names">
              {catalog.map((f) => (
                <button
                  key={f.scheme_name}
                  type="button"
                  className={`faq-filter-chip faq-filter-chip--full${selectedFunds.has(f.scheme_name) ? " faq-filter-chip--active" : ""}`}
                  disabled={disabled}
                  onClick={() => onToggleFund(f.scheme_name)}
                  title={f.scheme_name}
                >
                  {f.scheme_name}
                </button>
              ))}
            </div>
          </div>

          {selectedFunds.size === 0 ? (
            <p className="faq-filter-hint faq-filter-hint--warning">
              Please select at least one fund to ask questions.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
