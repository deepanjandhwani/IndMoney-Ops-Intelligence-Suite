---
name: Scheduler reference alignment
overview: Align the advisor scheduler with the nextleap-voice-agent reference implementation across three phases. Phase A (Safe deterministic fixes) requires no new dependencies. Phase B (LLM fallback, feature-flagged) adds Gemini structured output behind the existing regex parsers. Phase C (Voice overhaul) replaces client-side Web Speech with server-side Deepgram STT + TTS via a batch HTTP endpoint, keeping Web Speech API as fallback.
todos:
  - id: phase-a-phonetics
    content: "Phase A: Add STT phonetic patterns to topics.ts (spaced letters, dotted, phonetic pronunciations for all 5 topics)"
    status: completed
  - id: phase-a-retry-cap
    content: "Phase A: Add MAX_STATE_RETRIES=3 to state-machine.ts — transition to closing after 3 failed attempts in booking_code, intent, slot_selection, topic states"
    status: completed
  - id: phase-a-cancel-disambig
    content: "Phase A: Remove 'cancel' from isNo in topics.ts, create isNegativeWithoutCancel, update confirmation state to route 'cancel' to intent pivot"
    status: completed
  - id: phase-a-weekday-edge
    content: "Phase A: Update weekdayDate in time-preference.ts — when delta=0, return next week instead of today"
    status: completed
  - id: phase-a-tests
    content: "Phase A: Tests for retry cap, phonetic topics, cancel disambiguation, weekday edge case (27 tests)"
    status: completed
  - id: phase-b-llm-fallback
    content: "Phase B: Create src/services/scheduler/llm-fallback.ts — Gemini structured output fallback (SchedulerTurnDecision type, 5s timeout, null on failure, feature-flagged)"
    status: completed
  - id: phase-b-llm-day
    content: "Phase B: Create src/services/scheduler/llm-day-resolution.ts — Gemini day resolution fallback for ambiguous dates"
    status: completed
  - id: phase-b-wire-engine
    content: "Phase B: Wire LLM fallback into state-machine.ts — classifyIntentLlm after regex unclear, resolveRequestedDay in handleTimePreference"
    status: completed
  - id: phase-b-tests
    content: "Phase B: Tests for LLM fallback mock (intent + day resolution), feature flag off/on, timeout handling (9 tests)"
    status: completed
  - id: phase-c-deepgram-adapter
    content: "Phase C: Create src/adapters/deepgram/index.ts — Deepgram HTTP adapter for STT (transcribeAudio) and TTS (synthesizeSpeech)"
    status: completed
  - id: phase-c-voice-format
    content: "Phase C: Create src/services/scheduler/voice-format.ts — formatForVoice() pipeline and buildTtsText() for code spelling and URL replacement"
    status: completed
  - id: phase-c-voice-route
    content: "Phase C: Create app/api/scheduler/voice-turn/route.ts — batch voice endpoint: audio in → STT → engine → voice format → TTS → base64 audio out"
    status: completed
  - id: phase-c-ui-refactor
    content: "Phase C: UI refactor deferred — backend voice pipeline is complete and tested. Client-side hold-to-talk UX with MediaRecorder can be wired up separately."
    status: pending
  - id: phase-c-tests
    content: "Phase C: Tests for voice format, Deepgram adapter mock (19 tests)"
    status: completed
  - id: doc-updates
    content: "Update docs: voiceAgent.md (LLM budget), architecture.md (Phase 6 env var), edgeCase.md (retry cap, cancel, weekday, phonetics), decisions.md (env var fix)"
    status: completed
isProject: true
---

# Scheduler Reference Alignment Plan

Align the advisor scheduler with the [nextleap-voice-agent](https://github.com/deepanjandhwani/nextleap-voice-agent) reference across deterministic fixes, LLM-assisted fallback, and voice infrastructure — while preserving the current implementation's strengths (Supabase persistence, HITL approval, encrypted secure details, MCP integrations).

## Governing ADRs

| ADR | Decision |
|-----|----------|
| ADR-004 (unchanged) | Deepgram STT primary, Web Speech API fallback for STT |
| **ADR-004a (new)** | Deepgram Aura TTS primary, Browser SpeechSynthesis fallback for TTS |
| **ADR-024 (new)** | HTTP batch voice transport (`POST /voice-turn`) instead of WebSocket streaming |
| **ADR-025 (new)** | Deterministic-first + Gemini Flash-Lite structured fallback, feature-flagged, 0-2 calls/conversation |

## Non-Goals (Explicitly Out of Scope)

These are areas where the current implementation intentionally diverges from (and exceeds) the reference:

- **No downgrade to in-memory sessions.** Current Supabase + SQLite persistence is superior to the reference's ephemeral `dict`.
- **No removal of HITL approval workflow.** The reference has no admin gate; current system has full pre/post-confirmation approval lifecycle.
- **No removal of encrypted secure details flow.** Reference collects PII in-conversation; current system uses opaque-token encrypted submission.
- **No migration to FastAPI.** The scheduler runs on Next.js API routes (Vercel). Only the FastMCP sidecar is Python.
- **No replacement of Google MCP integrations.** Calendar/Sheets/Gmail integrations via FastMCP are mature and tested.
- **No same-day weekday logic.** The reference returns same-day for "Monday" when today is Monday. Current behavior (next week) is more intuitive for booking flows.

## Phase A — Safe Deterministic Fixes (No New Dependencies)

Zero-risk changes to the regex parsers and state machine. No LLM calls, no new packages, no voice changes. Can be shipped and tested independently.

### A1. STT Phonetic Patterns in `topics.ts`

**File:** `src/services/scheduler/topics.ts`

Add regex patterns that handle common speech-to-text artifacts:

| Topic | Current regex | Added patterns |
|-------|--------------|----------------|
| KYC / Onboarding | `\b(1\|kyc\|onboard)` | `k y c`, `k.y.c`, `kay why see`, `kay wye see` |
| SIP / Mandates | `\b(2\|sip\|mandate)` | `s i p`, `s.i.p`, `ess eye pee` |
| Statements / Tax Docs | `\b(3\|statement\|tax\|doc)` | `statement`, `capital gain` (already covered) |
| Withdrawals & Timelines | `\b(4\|withdraw\|timeline)` | `with draw`, `time line` (space-split) |
| Account Changes / Nominee | `\b(5\|account\|nominee\|change)` | `nomi nee`, `no mini` (phonetic artifacts) |

**Critical fix:** Reorder the KYC-change vs KYC match to prevent "account changes" from matching KYC before matching Account Changes / Nominee.

### A2. Retry Cap (MAX_STATE_RETRIES = 3)

**File:** `src/services/scheduler/state-machine.ts`

Add a `retry_count` check per state. After 3 consecutive failures in the same state (`booking_code`, `intent_classification`, `slot_selection`, `topic_collection`), transition to `closing` with a helpful exit message instead of looping forever.

```typescript
if ((current.retry_count ?? 0) >= MAX_STATE_RETRIES) {
  return {
    response: "I'm having trouble understanding. You can try again later or use the chat to type your request.",
    next_state: "closing",
    context: { ...current, state: "closing" }
  };
}
```

The current code has `retry_count` but no cap — it increments indefinitely.

### A3. Cancel Disambiguation

**File:** `src/services/scheduler/topics.ts`

**Problem:** `isNo()` includes `cancel` in its regex. When a user is in the `confirmation` state and says "cancel", it's treated as "no" (decline this slot) instead of routing to the cancellation intent.

**Fix:**
- Create `isNegativeWithoutCancel()` that excludes "cancel" from the no-pattern
- Use `isNegativeWithoutCancel()` in the confirmation state handler
- When the user says "cancel" in confirmation, trigger `trySchedulerIntentPivot` to route to the cancel flow

### A4. Weekday Edge Case

**File:** `src/services/scheduler/time-preference.ts`

**Problem:** When user says "Monday" and today is Monday, `weekdayDate` returns today (delta=0). For booking, the next occurrence is more useful since same-day booking is unlikely to have availability.

**Fix:** When delta === 0, add 7 days to return next week's occurrence.

### A5. Phase A Tests

**File:** `test/scheduler-workflow.test.ts` (extend) + new test files as needed

- Retry cap: 4 consecutive bad inputs → closing state
- Phonetic topic matching: "k y c" → KYC, "ess eye pee" → SIP
- Cancel disambiguation: "cancel" in confirmation → intent pivot, not "no"
- Weekday: "Monday" on a Monday → next Monday

---

## Phase B — LLM Fallback (Feature-Flagged)

Adds Gemini 2.5 Flash-Lite as a structured-output fallback behind existing regex. Controlled by `SCHEDULER_LLM_FALLBACK_ENABLED` env var (default: `true`). When disabled, behavior is identical to Phase A.

### B1. Intent Classification Fallback

**New file:** `src/services/scheduler/llm-fallback.ts`

```typescript
interface SchedulerTurnDecision {
  intent: SchedulerIntent | "advice" | "unclear";
  confidence: number;
  topic_hint?: string;
}

export async function classifyIntentWithLlm(
  input: string,
  currentState: SchedulerState
): Promise<SchedulerTurnDecision | null> {
  if (!process.env.SCHEDULER_LLM_FALLBACK_ENABLED) return null;
  // Gemini 2.5 Flash-Lite, responseSchema for structured JSON
  // 5-second timeout, return null on timeout/error
  // State aliasing: map code states to prompt-friendly names
}
```

**Integration into state-machine.ts:**

```
User input → classifySchedulerIntent(input)  [regex]
    ├── match found → use it (0 LLM calls)
    └── returns "unclear" → classifyIntentWithLlm(input)  [Gemini]
        ├── returns valid intent with confidence ≥ 0.6 → use it
        ├── returns "unclear" or confidence < 0.6 → ask user to clarify
        └── returns null (timeout/error) → ask user to clarify
```

### B2. Day Resolution Fallback

**New file:** `src/services/scheduler/llm-day-resolution.ts`

```typescript
interface DayResolution {
  date: string;       // YYYY-MM-DD
  reasoning: string;  // for observability
}

export async function resolveRequestedDay(
  input: string,
  today: Date
): Promise<DayResolution | null> {
  if (!process.env.SCHEDULER_LLM_FALLBACK_ENABLED) return null;
  // Gemini 2.5 Flash-Lite, responseSchema for structured JSON
  // 5-second timeout, return null on timeout/error
}
```

**Integration into state-machine.ts / time-preference.ts:**

```
User input → resolveDayPreference(input)  [regex]
    ├── date found → use it (0 LLM calls)
    └── returns null → resolveRequestedDay(input)  [Gemini]
        ├── returns valid date → use it
        └── returns null → ask user "Which day works for you?"
```

### B3. LLM Budget — Updated Per-Intent Table

| Intent | Deterministic success | Regex miss (intent) | Regex miss (date) | Both miss | Tokens (worst) |
|--------|----------------------|--------------------|--------------------|-----------|----------------|
| `book_new` | 0 calls | 1 call (~80 tok) | 1 call (~80 tok) | 2 calls (~160 tok) | ~160 |
| `reschedule` | 0 calls | 1 call | 1 call | 2 calls | ~160 |
| `cancel` | 0 calls | 1 call | N/A (no date) | 1 call | ~80 |
| `what_to_prepare` | 0 calls | 1 call | N/A | 1 call | ~80 |
| `check_availability` | 0 calls | 1 call | N/A | 1 call | ~80 |

**Typical case:** 0 calls (regex handles "book a call", "tomorrow", "Monday").
**Worst case:** 2 calls, ~160 tokens, Gemini 2.5 Flash-Lite (15 RPM, 1,000 RPD).

### B4. Phase B Tests

- LLM fallback fires only when regex returns "unclear"
- LLM returns valid intent → state transitions correctly
- LLM returns null (timeout) → user gets clarification prompt
- Feature flag off → LLM never called, regex-only behavior
- Day resolution: "day after long weekend" → valid date via LLM
- Day resolution: LLM returns null → user prompted for explicit date

---

## Phase C — Voice Overhaul (Deepgram STT + TTS, Batch HTTP)

Replaces client-side Web Speech API as primary with server-side Deepgram. Web Speech API remains as fallback (per ADR-004). Uses HTTP batch transport (per ADR-024).

### C1. Deepgram HTTP Adapter

**New file:** `src/adapters/deepgram/index.ts`

```typescript
export async function transcribeAudio(
  audioBuffer: Buffer,
  options?: { model?: string; language?: string; keywords?: string[] }
): Promise<{ transcript: string; confidence: number }>;

export async function synthesizeSpeech(
  text: string,
  options?: { model?: string; voice?: string }
): Promise<Buffer>;  // raw audio bytes
```

- STT: Deepgram REST API (`POST /v1/listen`), model `nova-2`, `smart_format: true`, `punctuate: true`
- TTS: Deepgram REST API (`POST /v1/speak`), model `aura-asteria-en`
- Keyword boosting: `["ELSS:2", "SIP:2", "nominee:2", "KYC:2"]`
- Error handling: throw typed errors for credit exhaustion, API unreachable, invalid audio

### C2. Voice Formatter

**New file:** `src/services/scheduler/voice-format.ts`

Pipeline that transforms state machine text output into voice-friendly text:

```typescript
export function formatForVoice(text: string): string {
  return pipe(
    stripMarkdown,        // remove **, [], (), #
    collapseNumberedLists, // "1. KYC 2. SIP" → "KYC, SIP, ..."
    spellBookingCode,      // "NL-A742" → "N, L, dash, A, 7, 4, 2"
    replaceUrls,           // URLs → "I'll send you a link"
    truncateForTts         // max ~300 chars for natural pacing
  )(text);
}

export function buildTtsText(text: string, bookingCode?: string): string {
  let result = formatForVoice(text);
  if (bookingCode) {
    const spelled = spellBookingCode(bookingCode);
    result += ` I'll repeat your booking code: ${spelled}.`;
  }
  return result;
}
```

### C3. Voice Turn Endpoint

**New file:** `app/api/scheduler/voice-turn/route.ts`

```typescript
export const maxDuration = 30; // Vercel function timeout

export async function POST(request: NextRequest) {
  // 1. Extract audio from multipart form data
  // 2. Call transcribeAudio(audioBuffer) → transcript
  // 3. PII check: maskPii(transcript)
  // 4. Call processSchedulerMessage(transcript, context, deps, "voice")
  // 5. Apply formatForVoice(response.response)
  // 6. Call synthesizeSpeech(voiceText) → audioBuffer
  // 7. Return JSON { transcript, response, audio_base64, context }
}
```

**Fallback path:** If Deepgram STT fails, return `{ error: "stt_unavailable", fallback: "web_speech_api" }`. The client detects this and switches to `useSpeechToText` + regular `POST /api/scheduler/message`.

### C4. UI Refactor

**File:** `src/ui/UnifiedCustomerAssistantClient.tsx`

Changes:
1. **Hold-to-talk mic:** Replace continuous `useSpeechToText` with `MediaRecorder` that records while button is held, sends audio to `/voice-turn` on release
2. **Server-side TTS playback:** Decode `audio_base64` from response, play via `AudioContext`
3. **Web Speech API fallback:** If `/voice-turn` returns `stt_unavailable`, fall back to existing `useSpeechToText` hook + Browser SpeechSynthesis
4. **Fix `input_mode` tracking:** Currently hardcoded to `"chat"` in `sendSchedulerMessage`. Track actual input mode and send correct value.
5. **Mode badge:** Show "Fund Q&A" vs "Advisor booking — voice available" near composer (absorbed from superseded unified surface plan)
6. **Mic visibility:** Hidden in FAQ mode, visible only when `activeScheduler === true`
7. **Fallback banner:** "Using browser voice — quality may vary" when in Web Speech fallback mode

### C5. Phase C Tests

- Voice format: booking code spelling, URL replacement, markdown stripping, list collapsing
- Deepgram adapter: mock HTTP responses for STT and TTS, error handling
- Voice-turn route: end-to-end mock (audio in → transcript → engine → formatted response → audio out)
- Fallback: STT failure triggers web_speech_api fallback flag

---

## Phase D — Documentation Updates

All doc changes to keep the specification accurate after Phases A-C.

### D1. `docs/architecture/voiceAgent.md`

| Section | Change |
|---------|--------|
| 1.2 TTS Evaluation | Update "Selected" to Deepgram Aura (primary) + Browser SpeechSynthesis (fallback). Reference ADR-004a. |
| 1.3 Recommendation | Update TTS row. |
| 1.4 Audio Streaming Design | Replace WebSocket diagram with HTTP batch diagram. Reference ADR-024. |
| 2.3 State Definitions | Add note that intent_classification is currently regex-only with optional LLM fallback (ADR-025). |
| 9 LLM Calls Per Booking | Update budget tables to show 0-2 calls range per ADR-025. Add "Typical case: 0" and "Worst case: 2". |
| 8.1 Voice-Specific Errors | Replace WebSocket disconnect errors with batch HTTP errors. Keep Web Speech API fallback errors. |

### D2. `docs/architecture.md`

| Section | Change |
|---------|--------|
| Phase 6 | Update deliverables: Deepgram STT+TTS (batch HTTP), Browser SpeechSynthesis/Web Speech API fallback, LLM fallback for scheduler (feature-flagged), STT phonetic patterns, retry cap, voice formatter. |

### D3. `docs/edgeCase.md`

| Section | Change |
|---------|--------|
| Voice Scheduler Edge Cases | Replace "Deepgram WebSocket disconnects" with "Deepgram API unreachable (batch)". Keep Web Speech API fallback and chat fallback. Add "LLM fallback timeout → ask user to clarify". |

### D4. Cross-references

- `decisions.md` ADR-004a, ADR-024, ADR-025 are already written (this plan's prerequisite).
- `rules.md` — no changes needed (Web Speech API fallback preserved, cost rules satisfied by ADR-004a).

---

## Sequencing and Dependencies

```
Phase A (deterministic) ──┐
                          ├── Phase D (docs)
Phase B (LLM fallback) ──┤
                          │
Phase C (voice) ──────────┘
```

- A and B are independent of each other and can be developed in parallel.
- C depends on A (phonetic patterns feed voice-transcribed input) and B (LLM fallback handles voice-ambiguous inputs).
- D should be done last, after A-C are code-complete, to avoid updating docs twice.

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Deepgram credits exhaust during development | Web Speech API fallback (ADR-004), Browser SpeechSynthesis fallback (ADR-004a). Both are free. |
| LLM fallback produces wrong intent | 5s timeout + null-on-error + feature flag. Worst case: user is asked to clarify (same as regex miss). |
| Vercel function timeout on voice-turn | `maxDuration: 30` covers STT (~1s) + engine (~0.1s) + TTS (~0.5s) with margin. Monitor `elapsed_ms`. |
| Voice format strips important information | TTS text is a supplement — full text response is always displayed in chat thread. Voice only speaks the condensed version. |
| Existing tests break | Phase A and B changes are additive (new patterns, new fallback paths). Existing regex tests remain valid. |
