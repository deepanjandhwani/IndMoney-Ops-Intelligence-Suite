# Edge Cases

## Booking Edge Cases
- Customer provides wrong booking code on reschedule → return clear 
  error, do not create new booking
- Generated booking code collides with existing code → retry generation 
  up to 5 times, then surface error in Admin dashboard
- Customer tries to cancel already-cancelled booking → inform status, 
  no duplicate cancellation
- Slot selected by customer becomes unavailable before confirmation → 
  re-offer available slots, do not confirm stale slot
- Two customers select same slot concurrently → create hold only after 
  final availability re-check; loser gets refreshed slots
- Admin rejects booking → HITL status = rejected, 
  Sheet status = rejected, no customer-facing confirmation sent
- MCP call fails after booking saves → surface partial failure in HITL, 
  do not silently drop
- DB write fails after one or more MCP actions succeed → mark orphaned 
  integration artifacts for Admin cleanup and retry DB persistence; 
  never send customer-facing confirmation
- Secure details link expired or missing → allow Admin review, but do 
  not add customer attendee or send calendar invite until details are submitted

## RAG Edge Cases
- Question matches no chunk in vector store → return refusal, 
  do not hallucinate answer
- Question partially matches fee explainer and scheme fact → 
  retrieve both, cite both sources separately
- User tries to inject PAN or account number in FAQ question → 
  mask with [REDACTED], do not process or store raw PII
- Source URL returns 404 during ingestion → log as failed, 
  flag in source manifest, do not ingest partial content
- BM25 reranking returns empty candidate set (all candidates 
  filtered out) → fall back to pure cosine similarity results 
  from vector search. Do not return empty answer.
- Playwright scraper timeout or partial page load → log as 
  failed for that source_id, flag in source manifest, do not 
  ingest partial content. Retry once with extended timeout.
- Content hash comparison failure during re-ingestion (hash 
  mismatch but content appears identical) → force re-ingest 
  to be safe, log the hash discrepancy for debugging.
- ChromaDB unavailable or collection missing → return source-limited 
  no-results response, surface Admin health error, do not call LLM with 
  empty context
- Embedding API fails during ingestion → mark source as failed, retry 
  with exponential backoff, do not upsert partial chunks

## Review Ingestion Edge Cases
- Google Play scraper returns 0 reviews → log as partial_success, 
  do not overwrite previous pulse
- Duplicate review detected → skip and increment duplicate counter, 
  do not store
- PII found in review text → mask before storage, 
  never store raw PII
- GitHub Actions run fails mid-ingestion → mark run as failed, 
  preserve previously stored reviews
- All reviews assigned to noise cluster (no themes found) → 
  lower min_cluster_size to 3, retry clustering once. If still 
  no clusters, return previous cached pulse with a flag.
- Fewer reviews than min_cluster_size in rolling window → 
  skip clustering, return previous cached pulse. Do not generate 
  empty themes.

## Voice Scheduler Edge Cases
- User speaks PAN or phone number → mask immediately, 
  do not process or repeat back
- Low confidence transcription → ask user to repeat, 
  do not guess intent
- User goes silent mid-flow → timeout with prompt to continue 
  or restart
- Booking code spoken unclearly → confirm by reading back 
  character by character
- Deepgram WebSocket disconnects mid-session → reconnect WebSocket 
  (max 3 retries), then fall back to Web Speech API. Show banner: 
  "Voice quality may vary."
- Deepgram credits exhausted → fall back to Web Speech API if supported, 
  otherwise redirect to chat. Surface clear Admin warning that Deepgram 
  is credit-limited.
- Microphone permission denied → display message: "Please allow 
  microphone access or use chat instead." Do not retry permission 
  request. Offer chat fallback.
- Browser unsupported for voice (no SpeechRecognition + Deepgram 
  unavailable) → redirect to chat interface with message: 
  "Voice is not supported in this browser."

## LLM Call Edge Cases
- LLM API rate limit hit → queue and retry with exponential backoff, 
  do not drop the request
- LLM returns malformed JSON → retry once, if still malformed 
  return graceful error to user
- Classification returns low confidence → retry with more context 
  or fall back to manual selection
- Cached Review Pulse is stale (>7 days) → trigger regeneration 
  before serving, show loading state
- Free tier credits exhausted → surface clear error in Admin 
  dashboard, degrade gracefully (show cached data, 
  disable new LLM calls)

## MCP / Integration Edge Cases
- Google Calendar API down → create booking in DB and HITL, 
  mark calendar_status as failed, retry later
- Calendar event not found on update/cancel → mark calendar_status as 
  failed, surface retry/recreate option in HITL
- Google Sheets API down → create booking in DB and HITL, 
  mark sheet_status as failed, retry later
- Sheet row not found on update → append recovery row with same booking_code 
  only after Admin retry; keep sheet_status failed until recovered
- Gmail API down → create booking in DB and HITL, 
  mark email_draft_status as failed, retry later
- OAuth token expired → surface re-auth prompt in Admin dashboard, 
  do not silently fail