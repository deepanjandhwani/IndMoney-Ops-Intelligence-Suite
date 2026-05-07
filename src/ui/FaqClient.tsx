"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

import type { AssistantSessionEventRow } from "@/adapters/supabase/assistant-history-repository";
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

type FaqMessage = {
  id: string;
  role: "assistant" | "user";
  text: string;
  citations?: Citation[];
  status?: string;
  suggestedFunds?: string[];
};

type FundCatalogEntry = {
  scheme_name: string;
};

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
    const re = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|(https?:\/\/[^\s),]+))/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      if (m.index > last) tokens.push(line.slice(last, m.index));
      if (m[2]) tokens.push(<strong key={`i${key++}`}>{m[2]}</strong>);
      else if (m[3]) tokens.push(<em key={`i${key++}`}>{m[3]}</em>);
      else if (m[4]) tokens.push(<code key={`i${key++}`} className="md-code">{m[4]}</code>);
      else if (m[5]) tokens.push(<a key={`i${key++}`} href={m[5]} target="_blank" rel="noreferrer" className="inline-link">{m[5]}</a>);
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

function toggleSet<T>(prev: Set<T>, value: T): Set<T> {
  const next = new Set(prev);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }
  return next;
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

function normalizeConversationStub(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^[!?.,;:]+/, "")
    .replace(/\s+/g, " ")
    .replace(/[!?.,;:]+$/, "")
    .trim();
}

function looksLikeFaqIntent(input: string) {
  return /\b(exit load|expense ratio|lock-?in|benchmark|riskometer|fee|fees|statement|tax|citation|nav\b|aum\b|holdings?|fund objective|investment objective|minimum sip|min sip|scheme|fund manager|returns?|ranking|stamp duty|about .+ fund|what is|tell me about|elss|sip\b|lump\s*sum|folio|stcg|ltcg|capital gains|dividend|idcw)\b/i.test(
    input
  );
}

function looksLikeConversationalOnly(raw: string) {
  const n = normalizeConversationStub(raw);
  if (!n || n.length > 64) return false;
  if (looksLikeFaqIntent(raw)) return false;
  if (normalizeConversationStub(raw).split(/\s+/).length > 6) return false;

  const thanks = /^(thanks|thank you|thx|ty)(\s+(a lot|again|so much))?$/;
  const farewell =
    /^(bye|goodbye|cya|see\s+you|see\s+ya)(\s+(later|soon))?$/;
  const ack = /^(ok|okay|sure|cool|got it)(\s+(thanks|thank you))?$/;
  const greet =
    /^(hi|hello|hey|hiya|howdy)(\s+(there|team|groww|all))?$|^(good\s+(morning|afternoon|evening))$/;

  return greet.test(n) || thanks.test(n) || farewell.test(n) || ack.test(n);
}

function conversationalReplyText(raw: string) {
  const n = normalizeConversationStub(raw);
  if (/^(thanks|thank you|thx|ty)/.test(n)) {
    return "You\u2019re very welcome. Whenever you\u2019re ready, use the search box for fund questions.";
  }
  if (/^(bye|goodbye|cya|see\s+you|see\s+ya)/.test(n)) {
    return "Goodbye, and thank you for stopping by. You\u2019re welcome back any time for scheme information.";
  }
  if (/^(ok|okay|sure|cool|got it)/.test(n)) {
    return "Sounds good\u2014whenever you\u2019re ready, type your fund question below.";
  }
  return "Hi there! For factual questions about the approved schemes, use the search box below. For your privacy, please avoid sharing personal identifiers here.";
}

function createWelcomeMessage(): FaqMessage {
  return {
    id: "welcome",
    role: "assistant",
    text:
      "Welcome! You can ask about any approved mutual fund scheme\u2014exit loads, fees, holdings, NAV, and more. Informal names like \"HDFC Defence fund\" work fine. To keep you safe, please avoid sharing personal identifiers in this chat."
  };
}

function eventsToFaqMessages(events: AssistantSessionEventRow[]): FaqMessage[] {
  return events.map((ev, index) => {
    const row: FaqMessage = {
      id: typeof ev.id === "string" && ev.id ? ev.id : `hist-${index}`,
      role: ev.role,
      text: ev.content,
      status: ev.status ?? undefined
    };

    if (ev.citations && Array.isArray(ev.citations)) {
      row.citations = ev.citations as Citation[];
    }

    return row;
  });
}

// ─── Fund filter bar ────────────────────────────────────────────────────────

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
            {isOpen ? "\u25B2" : "\u25BC"}
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

// ─── Main component ─────────────────────────────────────────────────────────

export function FaqClient() {
  const history = useAssistantHistory();
  const [messages, setMessages] = useState<FaqMessage[]>(() => [createWelcomeMessage()]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySessions, setHistorySessions] = useState<AssistantHistorySessionSummary[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [viewingReadonly, setViewingReadonly] = useState(false);
  const liveMessagesRef = useRef<FaqMessage[]>([]);
  const readonlySourceSessionIdRef = useRef<string | null>(null);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fundCatalog, setFundCatalog] = useState<FundCatalogEntry[]>([]);
  const [selectedFunds, setSelectedFunds] = useState<Set<string>>(new Set());
  const [filterBarOpen, setFilterBarOpen] = useState(true);

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
    }
    setHistoryBusy(true);
    try {
      const events = await history.loadSessionTranscript(sessionId);
      setMessages(eventsToFaqMessages(events));
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
    setViewingReadonly(false);
    readonlySourceSessionIdRef.current = null;
  }

  function continueFromHistoryPoint() {
    const prior = readonlySourceSessionIdRef.current;
    history.startNewSession();
    setViewingReadonly(false);
    readonlySourceSessionIdRef.current = null;
    setError(null);
    setSelectedFunds(new Set());
    setMessages([
      {
        id: `resume-${Date.now()}`,
        role: "assistant",
        text: prior
          ? `Continuing from a previous chat (reference id: ${prior}). Ask a new question whenever you\u2019re ready.`
          : "New chat \u2014 ask a question whenever you\u2019re ready."
      }
    ]);
  }

  function toolbarNewChat() {
    history.startNewSession();
    setViewingReadonly(false);
    readonlySourceSessionIdRef.current = null;
    liveMessagesRef.current = [];
    setError(null);
    setMessages([createWelcomeMessage()]);
    setSelectedFunds(new Set());
    setHistoryOpen(false);
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

  function appendMessage(message: Omit<FaqMessage, "id">) {
    setMessages((current) => [
      ...current,
      {
        ...message,
        id: `${Date.now()}-${current.length}`
      }
    ]);
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
      text: data.answer,
      citations: data.status === "answered" && !/not enough information/i.test(data.answer)
        ? data.citations : [],
      status:
        ragStatusLabel && data.pii_masked ? `${ragStatusLabel} \u00B7 details redacted` : ragStatusLabel,
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
        ragStatusLabel && data.pii_masked ? `${ragStatusLabel} \u00B7 details redacted` : ragStatusLabel
    });
  }

  async function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (viewingReadonly) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    await routeMessage(trimmed);
    setText("");
  }

  async function routeMessage(rawText: string) {
    if (viewingReadonly) return;
    const trimmed = rawText.trim();
    if (!trimmed || loading) return;

    setError(null);
    appendMessage({ role: "user", text: trimmed });
    history.appendEvent({
      role: "user",
      lane: "rag",
      kind: "faq_question",
      content: trimmed
    });
    setLoading(true);

    try {
      if (looksLikeConversationalOnly(trimmed)) {
        const reply = conversationalReplyText(trimmed);
        appendMessage({ role: "assistant", text: reply });
        history.appendEvent({
          role: "assistant",
          lane: "rag",
          kind: "greeting",
          content: reply
        });
      } else {
        await sendFaqQuestion(trimmed);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Request failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="unified-assistant unified-assistant--refined">
      <div className="assistant-workspace assistant-workspace--single">
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
              {!viewingReadonly ? (
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

          <div className={`assistant-thread${viewingReadonly ? " assistant-thread--readonly" : ""}`} aria-live="polite">
            {messages.map((message) => (
              <article className={`assistant-message ${message.role}`} key={message.id}>
                <div className="message-meta">
                  <strong>{message.role === "assistant" ? "Sources" : "You"}</strong>
                  {message.status ? <span className="message-status-pill">{message.status}</span> : null}
                </div>
                <div className={`message-body${
                  (message.suggestedFunds && message.suggestedFunds.length > 0) || message.text.startsWith("Please select at least one fund")
                    ? " fund-selection-warning"
                    : ""
                }`}>{renderMarkdown(message.text)}</div>

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
            {loading ? (
              <div className="faq-loading-indicator" role="status" aria-live="polite" aria-busy="true">
                <span className="faq-loading-spinner" aria-hidden />
                <span className="faq-loading-copy">
                  <strong>Searching approved sources</strong>
                  <span className="faq-loading-sub">Classifying your question and matching fund facts.</span>
                </span>
              </div>
            ) : null}
          </div>

          {error ? <p className="error-banner">{error}</p> : null}

          <div className="assistant-mode-badge" role="status">
            {viewingReadonly ? "Read-only past chat" : "Fund Q\u00A0&\u00A0A"}
          </div>

          <form className="faq-search-form" onSubmit={submitMessage}>
            <label htmlFor="faq-search-input">Question</label>
            <div className="faq-search-row">
              <input
                id="faq-search-input"
                type="search"
                name="faq-search"
                enterKeyHint="search"
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="Ask about a fund…"
                disabled={loading || viewingReadonly}
                autoComplete="off"
              />
              <button
                type="submit"
                disabled={loading || viewingReadonly || !text.trim()}
              >
                {loading ? "Searching…" : "Ask"}
              </button>
            </div>

            {!viewingReadonly && fundCatalog.length > 0 ? (
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
                        {session.lane_summary.rag}
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
