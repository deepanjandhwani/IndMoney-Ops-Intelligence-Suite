# System Rules

## Cost Rules
- Use free-tier services only. No paid services unless flagged 
  and approved.
- LLM: Use cheapest sufficient model per task.
  - Classification, safety checks: Gemini 2.5 Flash-Lite (15 RPM, 
    1,000 RPD) or Groq Llama 3 fallback (free, fast)
  - RAG answers, pulse generation, preparation guidance: Gemini 2.5 Flash 
    (10 RPM, 500 RPD)
  - Advisor email drafts are template-based and read Review Pulse context 
    from database; do not use a separate LLM call.
  - Note: Gemini 2.0 Flash is retired. Use 2.5-series only.
- Cache weekly outputs (Review Pulse, themes) in database.
- Do not make LLM calls for data that can be read from database.
- Theme clustering runs locally (BERTopic). LLM calls receive theme summaries, not raw reviews. No per-review LLM calls.
- Embeddings must use a free model (Gemini, Cohere free tier, 
  or local model).
- Vector DB is ChromaDB (`smart_sync_kb` single collection) for this project.
  Pinecone free tier is only a future migration option.
- Deepgram STT is credit-limited. If credits are exhausted or the API is 
  unavailable, fall back to Web Speech API or chat.

## PII Rules
- NEVER ask for: PAN, Aadhaar, phone, email, account number, OTP, 
  full name, address inside AI conversation
- ALWAYS replace detected PII with [REDACTED]
- Applies to: AI conversation, review storage, all eval outputs
- Verified in: Module F safety eval

## Advice Rules
- NEVER provide: buy/sell/hold, fund recommendations, return 
  predictions, portfolio advice, performance guarantees
- Refusal message (use exactly this string):
  "I can't provide investment advice, return predictions, or handle 
  personal account information. I can help with facts from approved 
  sources, such as exit load, expense ratio, lock-in, benchmark, 
  riskometer, fee explanation, or statement download steps."
- Verified in: Module F safety eval

## Citation Rules
- Every factual FAQ answer must include source_url + last_checked
- Fee answers cite source_id: fee_static_001
- No runtime web search. Predefined sources only.
- Verified in: Module F retrieval eval

## Booking Rules
- Booking code format: LL-LDDD — 2 letters + hyphen + 1 letter + 3 digits (example: NL-A742)
- Booking code must appear in: Calendar title, Sheet row, 
  Email subject, HITL payload
- Advisor email: NEVER auto-send. Draft only.
- Customer confirmation: requires Admin approval
- Customer calendar update: requires secure details + Admin approval
- Verified in: Module F integration eval

## Sync Rules
- Booking customer-facing status and Sheet row approval_status must always match
- Any Admin-approved HITL action that changes booking status must trigger Sheet update immediately
- Partial MCP failures must surface in HITL Center
- Verified in: Module F sync eval