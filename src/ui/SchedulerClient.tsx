"use client";

import { FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { AssistantSessionEventRow } from "@/adapters/supabase/assistant-history-repository";
import {
  resolveStandaloneDeferredGreetingFlush,
  type StandaloneAdvisorVoiceGate as AdvisorVoiceGate
} from "@/lib/advisor-voice-gate";
import { notifyCustomerPendingBookingsChanged } from "@/lib/customer-pending-bookings";
import { SchedulerOutput, SchedulerSessionContext, SlotOption } from "@/services/scheduler/types";
import { useAssistantHistory, type AssistantHistorySessionSummary } from "@/ui/useAssistantHistory";

type SchedulerMessage = {
  id: string;
  role: "assistant" | "user";
  text: string;
  slots?: SlotOption[];
  secureLink?: string;
  myBookingsRedirect?: boolean;
  status?: string;
};

type SchedulerChatGreetingResponse = SchedulerOutput & {
  tts_audio_base64?: string | null;
  tts_content_type?: string;
  tts_text?: string;
};

const SCHEDULER_CHAT_STORAGE_KEY = "groww-scheduler:chat-state";

/** Restored conversation from sessionStorage, or null for a fresh advisor session. */
function loadRestorableSchedulerChatFromStorage(): {
  messages: SchedulerMessage[];
  context: SchedulerSessionContext;
} | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SCHEDULER_CHAT_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as { messages?: SchedulerMessage[]; context?: SchedulerSessionContext };
    if (data.messages?.length && data.context && data.context.state !== "terminal") {
      return { messages: data.messages, context: data.context };
    }
  } catch {
    /* ignore */
  }
  return null;
}

const schedulerStates = new Set([
  "intent_classification",
  "reschedule_scope",
  "topic_collection",
  "topic_collection_optional",
  "time_collection",
  "booking_code_collection",
  "slot_selection",
  "offer_waitlist",
  "confirmation",
  "cancellation_confirm"
]);

// ─── Markdown renderer ─────────────────────────────────────────────────────

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

function formatHistoryTimestamp(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
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

function speakWithBrowserFallback(text?: string) {
  if (!text || typeof window === "undefined" || !window.speechSynthesis) return;
  const cleaned = text.replace(/\n+/g, " ").trim();
  if (!cleaned) return;
  const utterance = new SpeechSynthesisUtterance(cleaned);
  utterance.lang = "en-IN";
  window.speechSynthesis.speak(utterance);
}

function playSpeechSynthWithOnStart(text: string | undefined, onStarted: () => void): void {
  if (!text || typeof window === "undefined" || !window.speechSynthesis) {
    onStarted();
    return;
  }
  const cleaned = text.replace(/\n+/g, " ").trim();
  if (!cleaned) {
    onStarted();
    return;
  }
  const utterance = new SpeechSynthesisUtterance(cleaned);
  utterance.lang = "en-IN";
  utterance.onstart = () => onStarted();
  utterance.onerror = () => onStarted();
  try {
    window.speechSynthesis.speak(utterance);
  } catch {
    onStarted();
  }
}

/** Play TTS from a user gesture; invokes onSpeakStarted when audio/speech actually starts (or after safety timeout). */
function playTtsWithSpeakStarted(
  base64: string | null,
  contentType: string,
  fallbackText: string | undefined,
  onSpeakStarted: () => void
): void {
  if (typeof window === "undefined") {
    onSpeakStarted();
    return;
  }

  let finished = false;
  const safetyMs = 3500;
  const safetyId = window.setTimeout(() => done(), safetyMs);

  function done() {
    if (finished) return;
    finished = true;
    window.clearTimeout(safetyId);
    onSpeakStarted();
  }

  if (base64) {
    try {
      const audio = new Audio(`data:${contentType};base64,${base64}`);
      const onPlaying = () => {
        audio.removeEventListener("playing", onPlaying);
        done();
      };
      audio.addEventListener("playing", onPlaying);
      audio.addEventListener(
        "error",
        () => {
          audio.removeEventListener("playing", onPlaying);
          playSpeechSynthWithOnStart(fallbackText, done);
        },
        { once: true }
      );
      void audio.play().catch(() => {
        audio.removeEventListener("playing", onPlaying);
        playSpeechSynthWithOnStart(fallbackText, done);
      });
      return;
    } catch {
      playSpeechSynthWithOnStart(fallbackText, done);
    }
  } else {
    playSpeechSynthWithOnStart(fallbackText, done);
  }
}

type AdvisorGreetingTtsPayload = {
  response_text: string;
  tts_audio_base64: string | null;
  tts_content_type: string;
  tts_text: string;
};

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

// ─── History event → SchedulerMessage conversion ────────────────────────────

function eventsToSchedulerMessages(events: AssistantSessionEventRow[]): SchedulerMessage[] {
  return events.map((ev, index) => {
    const row: SchedulerMessage = {
      id: typeof ev.id === "string" && ev.id ? ev.id : `hist-${index}`,
      role: ev.role,
      text: ev.content,
      status: ev.status ?? undefined
    };

    if (ev.kind === "booking_link_issued") {
      row.text =
        "A secure booking link was shared in this session. If you need a new one, please start a fresh session\u2014happy to help.";
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

// ─── Component ──────────────────────────────────────────────────────────────

export function SchedulerClient() {
  const history = useAssistantHistory();
  const [messages, setMessages] = useState<SchedulerMessage[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySessions, setHistorySessions] = useState<AssistantHistorySessionSummary[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [viewingReadonly, setViewingReadonly] = useState(false);
  const liveMessagesRef = useRef<SchedulerMessage[]>([]);
  const liveSchedulerRef = useRef<SchedulerSessionContext | undefined>();
  const readonlySourceSessionIdRef = useRef<string | null>(null);
  const [schedulerContext, setSchedulerContext] = useState<SchedulerSessionContext | undefined>();
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advisorVoiceGate, setAdvisorVoiceGate] = useState<AdvisorVoiceGate>("off");
  const advisorVoiceGateRef = useRef<AdvisorVoiceGate>("off");
  const advisorGreetingTtsRef = useRef<AdvisorGreetingTtsPayload | null>(null);
  /** True when user tapped "start" while `GET ?mode=chat` is still in flight (ref beats gate timing vs fetch resolution). */
  const tapPendingWhileFetchRef = useRef(false);
  const [schedulerHydrated, setSchedulerHydrated] = useState(false);

  useEffect(() => {
    advisorVoiceGateRef.current = advisorVoiceGate;
  }, [advisorVoiceGate]);

  function startGreetingPlaybackFromStoredPayload(): void {
    const payload = advisorGreetingTtsRef.current;
    if (!payload) return;
    const { response_text: revealText, tts_audio_base64, tts_content_type, tts_text } = payload;
    setAdvisorVoiceGate("playing");
    playTtsWithSpeakStarted(
      tts_audio_base64,
      tts_content_type,
      tts_text,
      () => {
        setMessages((current) => [
          ...current,
          {
            role: "assistant",
            text: revealText,
            id: `greeting-${Date.now()}-${current.length}`
          }
        ]);
        setAdvisorVoiceGate("off");
        advisorGreetingTtsRef.current = null;
      }
    );
  }

  function ingestSchedulerGreetingResponse(data: SchedulerChatGreetingResponse): void {
    setSchedulerContext(data.context);
    history.appendEvent({
      role: "assistant",
      lane: "scheduler",
      kind: "scheduler_out",
      content: data.response_text,
      scheduler_state: data.context.state
    });
    advisorGreetingTtsRef.current = {
      response_text: data.response_text,
      tts_audio_base64: data.tts_audio_base64 ?? null,
      tts_content_type: data.tts_content_type ?? "audio/mpeg",
      tts_text: data.tts_text ?? data.response_text
    };
    const playNow = tapPendingWhileFetchRef.current;
    tapPendingWhileFetchRef.current = false;
    if (playNow) {
      startGreetingPlaybackFromStoredPayload();
    } else {
      setAdvisorVoiceGate("awaiting_tap");
    }
  }

  function ingestSchedulerGreetingFallback(copy: string): void {
    advisorGreetingTtsRef.current = {
      response_text: copy,
      tts_audio_base64: null,
      tts_content_type: "audio/mpeg",
      tts_text: copy
    };
    const playNow = tapPendingWhileFetchRef.current;
    tapPendingWhileFetchRef.current = false;
    if (playNow) {
      startGreetingPlaybackFromStoredPayload();
    } else {
      setAdvisorVoiceGate("awaiting_tap");
    }
  }

  const activeScheduler = useMemo(
    () =>
      Boolean(
        schedulerContext &&
          (schedulerStates.has(schedulerContext.state) || schedulerContext.slots_offered?.length)
      ),
    [schedulerContext]
  );

  function saveChatToSession(msgs: SchedulerMessage[], ctx: SchedulerSessionContext | undefined) {
    try {
      sessionStorage.setItem(SCHEDULER_CHAT_STORAGE_KEY, JSON.stringify({ messages: msgs, context: ctx }));
    } catch {
      /* private mode */
    }
  }

  useEffect(() => {
    if (messages.length > 0 && schedulerContext) {
      saveChatToSession(messages, schedulerContext);
    }
  }, [messages, schedulerContext]);

  // ── Auto-fetch greeting on mount (or restore previous chat) ─────────

  const greetingFetchedRef = useRef(false);

  useLayoutEffect(() => {
    if (greetingFetchedRef.current) return;
    greetingFetchedRef.current = true;

    const cached = loadRestorableSchedulerChatFromStorage();
    if (cached && cached.context.state !== "terminal") {
      setMessages(cached.messages);
      setSchedulerContext(cached.context);
      liveMessagesRef.current = cached.messages;
      liveSchedulerRef.current = cached.context;
      setAdvisorVoiceGate("off");
      advisorGreetingTtsRef.current = null;
      tapPendingWhileFetchRef.current = false;
      setSchedulerHydrated(true);
      return;
    }

    tapPendingWhileFetchRef.current = false;
    setAdvisorVoiceGate("awaiting_tap_preparing");
    setSchedulerHydrated(true);

    fetch("/api/scheduler/message?mode=chat")
      .then((res) => {
        if (!res.ok) throw new Error("Greeting fetch failed");
        return res.json();
      })
      .then((data: SchedulerChatGreetingResponse) => {
        ingestSchedulerGreetingResponse(data);
      })
      .catch(() => {
        ingestSchedulerGreetingFallback(
          "Welcome! I can help you book, reschedule, or cancel an advisor appointment. What would you like to do?"
        );
      })
      .finally(() => {
        setSchedulerHydrated(true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flushDeferredAdvisorGreetingToThread = useCallback(() => {
    const payload = advisorGreetingTtsRef.current;
    const resolved = resolveStandaloneDeferredGreetingFlush(
      advisorVoiceGateRef.current,
      payload ? { response_text: payload.response_text } : null
    );
    if (!resolved.flush) {
      return;
    }
    advisorGreetingTtsRef.current = null;
    setAdvisorVoiceGate("off");
    const revealText = resolved.greetingText;
    setMessages((current) => [
      ...current,
      {
        role: "assistant",
        text: revealText,
        id: `greeting-${Date.now()}-${current.length}`
      }
    ]);
  }, []);

  // ── Voice input ─────────────────────────────────────────────────────────

  const handleVoiceTurnResult = useCallback((result: VoiceTurnResult) => {
    flushDeferredAdvisorGreetingToThread();
    appendMessage({ role: "user", text: result.transcript });
    history.appendEvent({
      role: "user",
      lane: "scheduler",
      kind: "scheduler_in",
      content: result.transcript
    });

    setSchedulerContext(result.context);
    const schedLabel = result.pii_warning ? "Details redacted" : undefined;
    appendMessage({
      role: "assistant",
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
        text: "Your booking request has been captured. Head to My Bookings to complete your personal details. Admin review follows before confirmation.",
        myBookingsRedirect: true
      });
      notifyCustomerPendingBookingsChanged();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flushDeferredAdvisorGreetingToThread]);

  const voice = useVoiceInput({
    schedulerContext,
    onResult: handleVoiceTurnResult,
    onError: (msg) => setError(msg),
    onRecordingChange: (rec) => {
      if (rec) setError(null);
    }
  });

  const handleAdvisorTapToStart = useCallback(() => {
    if (advisorVoiceGate === "awaiting_tap_preparing") {
      tapPendingWhileFetchRef.current = true;
      setAdvisorVoiceGate("tap_pending_greeting_fetch");
      return;
    }
    if (advisorVoiceGate !== "awaiting_tap") return;
    startGreetingPlaybackFromStoredPayload();
  }, [advisorVoiceGate]);

  // ── History management ──────────────────────────────────────────────────

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
      setAdvisorVoiceGate("off");
      advisorGreetingTtsRef.current = null;
      tapPendingWhileFetchRef.current = false;
      setMessages(eventsToSchedulerMessages(events));
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
    setAdvisorVoiceGate("off");
    advisorGreetingTtsRef.current = null;
    tapPendingWhileFetchRef.current = false;
    setSchedulerContext(undefined);
    setViewingReadonly(false);
    readonlySourceSessionIdRef.current = null;
    setError(null);
    setMessages([{
      id: `resume-${Date.now()}`,
      role: "assistant",
      text: prior
        ? `Continuing from a previous session (reference id: ${prior}). What would you like to do?`
        : "New session \u2014 what would you like to do?"
    }]);
  }

  function toolbarNewChat() {
    history.startNewSession();
    advisorGreetingTtsRef.current = null;
    tapPendingWhileFetchRef.current = false;
    setSchedulerContext(undefined);
    setViewingReadonly(false);
    readonlySourceSessionIdRef.current = null;
    liveMessagesRef.current = [];
    setError(null);
    setMessages([]);
    try { sessionStorage.removeItem(SCHEDULER_CHAT_STORAGE_KEY); } catch { /* ignore */ }

    setAdvisorVoiceGate("awaiting_tap_preparing");
    setSchedulerHydrated(true);

    fetch("/api/scheduler/message?mode=chat")
      .then((res) => {
        if (!res.ok) throw new Error("Greeting fetch failed");
        return res.json();
      })
      .then((data: SchedulerChatGreetingResponse) => {
        ingestSchedulerGreetingResponse(data);
      })
      .catch(() => {
        ingestSchedulerGreetingFallback(
          "Welcome! I can help you book, reschedule, or cancel an advisor appointment. Is there something you need help with?"
        );
      });

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

  // ── Message submission ──────────────────────────────────────────────────

  async function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (viewingReadonly) return;
    const trimmed = text.trim();
    if (!trimmed || loading || advisorVoiceGate === "playing" || advisorVoiceGate === "awaiting_tap_preparing" || advisorVoiceGate === "tap_pending_greeting_fetch")
      return;

    setError(null);
    flushDeferredAdvisorGreetingToThread();
    appendMessage({ role: "user", text: trimmed });
    history.appendEvent({
      role: "user",
      lane: "scheduler",
      kind: "scheduler_in",
      content: trimmed
    });
    setText("");
    setLoading(true);

    try {
      await sendSchedulerMessage(trimmed);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Scheduler request failed.");
    } finally {
      setLoading(false);
    }
  }

  async function sendSchedulerMessage(messageText: string) {
    let currentContext = schedulerContext;

    if (!currentContext) {
      const greetRes = await fetch("/api/scheduler/message?mode=chat");
      if (greetRes.ok) {
        const greeting = (await greetRes.json()) as SchedulerOutput;
        currentContext = greeting.context;
        setSchedulerContext(currentContext);
        appendMessage({
          role: "assistant",
          text: greeting.response_text
        });
        history.appendEvent({
          role: "assistant",
          lane: "scheduler",
          kind: "scheduler_out",
          content: greeting.response_text,
          scheduler_state: greeting.context.state
        });
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
        text: "Your booking request has been captured. Head to My Bookings to complete your personal details. Admin review follows before confirmation.",
        myBookingsRedirect: true
      });
      notifyCustomerPendingBookingsChanged();
    }
  }

  function handleSlotClick(slot: SlotOption) {
    if (viewingReadonly || loading || advisorVoiceGate === "playing" || advisorVoiceGate === "awaiting_tap_preparing" || advisorVoiceGate === "tap_pending_greeting_fetch")
      return;

    const displayText = `Slot ${slot.id}: ${slot.label}`;
    setError(null);
    flushDeferredAdvisorGreetingToThread();
    appendMessage({ role: "user", text: displayText });
    history.appendEvent({
      role: "user",
      lane: "scheduler",
      kind: "scheduler_in",
      content: displayText
    });
    setLoading(true);

    sendSchedulerMessage(slot.id)
      .catch((requestError) => {
        setError(requestError instanceof Error ? requestError.message : "Scheduler request failed.");
      })
      .finally(() => setLoading(false));
  }

  function appendMessage(message: Omit<SchedulerMessage, "id">) {
    setMessages((current) => [
      ...current,
      {
        ...message,
        id: `${Date.now()}-${current.length}`
      }
    ]);
  }

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <section className="unified-assistant unified-assistant--refined">
      <div className="assistant-workspace assistant-workspace--single">
        <div className="assistant-faq-column">
          <div className="faq-head faq-head-with-toolbar">
            <div className="faq-head-main">
              <div>
                <span>Advisor</span>
                <h2>Speak to an Advisor</h2>
              </div>
              <p className="faq-head-note">
                Book, reschedule, cancel, check availability, or prepare for a call &mdash; without sharing
                identifiers here.
              </p>
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
            {!viewingReadonly && !schedulerHydrated && messages.length === 0 && advisorVoiceGate === "off" ? (
              <p className="muted scheduler-initial-greeting">Loading advisor…</p>
            ) : null}
            {messages.map((message) => (
              <article className={`assistant-message ${message.role}`} key={message.id}>
                <div className="message-meta">
                  <strong>{message.role === "assistant" ? "Booking" : "You"}</strong>
                  {message.status ? <span className="message-status-pill">{message.status}</span> : null}
                </div>
                <div className="message-body">{renderMarkdown(message.text)}</div>

                {message.slots?.length ? (
                  <div className="slot-card-grid" aria-label="Advisor slot options">
                    {message.slots.map((slot) => (
                      <button
                        type="button"
                        className="slot-card"
                        key={slot.id}
                        disabled={
                          viewingReadonly ||
                          loading ||
                          advisorVoiceGate === "playing" ||
                          advisorVoiceGate === "awaiting_tap_preparing" ||
                          advisorVoiceGate === "tap_pending_greeting_fetch"
                        }
                        onClick={() => handleSlotClick(slot)}
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
              </article>
            ))}
            {!viewingReadonly && advisorVoiceGate === "tap_pending_greeting_fetch" ? (
              <div
                className="advisor-voice-gate advisor-voice-gate--processing advisor-voice-gate--animated"
                role="status"
                aria-live="polite"
              >
                <span className="advisor-voice-spinner" aria-hidden />
                Starting advisor…
              </div>
            ) : null}
            {!viewingReadonly &&
            (advisorVoiceGate === "awaiting_tap_preparing" || advisorVoiceGate === "awaiting_tap") ? (
              <div
                className={`advisor-voice-gate advisor-voice-gate--animated advisor-voice-gate--tap-only${
                  advisorVoiceGate === "awaiting_tap_preparing" ? " advisor-voice-gate--tap-preparing" : ""
                }`}
                role="region"
                aria-label="Start advisor voice"
              >
                {advisorVoiceGate === "awaiting_tap_preparing" ? (
                  <div className="advisor-voice-gate--processing advisor-tap-preparing-row" aria-live="polite">
                    <span className="advisor-voice-spinner" aria-hidden />
                    <span>Preparing advisor voice…</span>
                  </div>
                ) : null}
                <button
                  type="button"
                  className="advisor-tap-to-start advisor-tap-to-start--circle"
                  onClick={handleAdvisorTapToStart}
                >
                  Tap to start
                </button>
              </div>
            ) : null}
            {!viewingReadonly && advisorVoiceGate === "playing" ? (
              <div
                className="advisor-voice-gate advisor-voice-gate--processing advisor-voice-gate--animated"
                role="status"
                aria-live="polite"
              >
                <span className="advisor-voice-spinner" aria-hidden />
                Starting advisor…
              </div>
            ) : null}
            {loading ? <p className="muted">Working…</p> : null}
          </div>

          {error ? <p className="error-banner">{error}</p> : null}

          <div
            className={`assistant-mode-badge${activeScheduler ? " assistant-mode-badge--advisor" : ""}`}
            role="status"
          >
            {viewingReadonly ? "Read-only past chat" : "Advisor session"}
          </div>

          <form className="faq-search-form" onSubmit={submitMessage}>
            <label htmlFor="scheduler-input">Message</label>
            <div className="faq-search-row">
              <input
                id="scheduler-input"
                type="search"
                name="scheduler-input"
                enterKeyHint="send"
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="Type your reply or hold the mic\u2026"
                disabled={
                  loading ||
                  viewingReadonly ||
                  advisorVoiceGate === "playing" ||
                  advisorVoiceGate === "awaiting_tap_preparing" ||
                  advisorVoiceGate === "tap_pending_greeting_fetch"
                }
                autoComplete="off"
              />
              {voice.supported ? (
                <button
                  type="button"
                  className={`secondary faq-mic-button${voice.recording ? " faq-mic-button--listening" : ""}${voice.processing ? " faq-mic-button--processing" : ""}`}
                  aria-label={voice.recording ? "Release to send" : voice.processing ? "Processing voice\u2026" : "Hold to speak"}
                  title={voice.recording ? "Release to send" : voice.processing ? "Processing\u2026" : "Hold to speak"}
                  disabled={
                    loading ||
                    viewingReadonly ||
                    voice.processing ||
                    advisorVoiceGate === "playing" ||
                    advisorVoiceGate === "awaiting_tap_preparing" ||
                    advisorVoiceGate === "tap_pending_greeting_fetch"
                  }
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
                disabled={
                  loading ||
                  viewingReadonly ||
                  advisorVoiceGate === "playing" ||
                  advisorVoiceGate === "awaiting_tap_preparing" ||
                  advisorVoiceGate === "tap_pending_greeting_fetch" ||
                  !text.trim()
                }
              >
                Send
              </button>
            </div>
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
          <aside className="assistant-history-drawer" aria-labelledby="scheduler-history-title">
            <header className="assistant-history-drawer-head">
              <h2 id="scheduler-history-title">Chat history</h2>
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
                        Last activity: {formatHistoryTimestamp(session.last_activity_at)} · Booking{" "}
                        {session.lane_summary.scheduler}
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
