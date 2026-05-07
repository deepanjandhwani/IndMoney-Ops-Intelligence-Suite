---
name: Scraper + UI + Routing Fixes
overview: Fix all scraper gaps (expanded holdings, absolute returns, advanced ratios, holding analysis, footer noise), improve the unified customer UI with fund picker and scope disclosure, add robust bidirectional lane switching between FAQ and scheduler, and handle generic questions (e.g. "What is NAV?") by prompting the user to pick a fund or returning cross-fund results.
todos:
  - id: scraper-interactions
    content: "Add expandInteractiveSections() to scrape.ts: click See All, Absolute returns tab, Read more, Holding Analysis, Advanced Ratios"
    status: pending
  - id: scraper-footer-strip
    content: Strip footer/nav noise in scrape.ts page.evaluate and add defense-in-depth stripFooterNoise() in chunk.ts
    status: pending
  - id: generic-question-clarification
    content: Add needs_fund_clarification to classify.ts, clarification_needed status to types.ts, clarification response in faq.ts with fund list
    status: pending
  - id: funds-api-endpoint
    content: Create GET /api/smart-sync-faq/funds/route.ts returning fund names from source manifest
    status: pending
  - id: lane-switching
    content: Rewrite routeMessage in UnifiedCustomerAssistantClient with priority-based bidirectional intent detection and lane indicator UI
    status: pending
  - id: ui-fund-chips-scope
    content: Add fund picker chips, scope disclosure banner, prominent Book Advisor CTA, and post-booking next-steps message
    status: pending
  - id: css-new-components
    content: Add styles for fund-chips, scope-banner, active-lane-indicator, sidebar-cta in globals.css
    status: pending
  - id: reingest-verify
    content: Run phase3:ingest with FORCE_REINGEST=true after scraper changes and verify expanded chunk content
    status: pending
isProject: false
---

# Scraper, Classifier, UI, and Routing Overhaul

## Workstream A: Scraper Improvements

The current scraper in [src/rag/scrape.ts](src/rag/scrape.ts) does a passive `page.evaluate(() => document.body.innerText)` after `networkidle`. It never clicks interactive elements, so collapsed/tabbed content is missed and site-wide footer noise is captured.

### A1. Click "See All" to expand holdings

Groww pages show ~10 holdings by default; the rest are behind a "See All" button. After `networkidle`, add a Playwright interaction step:

```typescript
const seeAllButton = page.locator('text="See All"').first();
if (await seeAllButton.isVisible({ timeout: 3000 }).catch(() => false)) {
  await seeAllButton.click();
  await page.waitForTimeout(1500);
}
```

This captures all 22 holdings (name, sector, instrument, % allocation) instead of just 10.

### A2. Click "Absolute returns" tab

The returns table has two tabs: Annualised (default) and Absolute. Scrape both:

```typescript
const absoluteTab = page.locator('text="Absolute returns"').first();
if (await absoluteTab.isVisible({ timeout: 2000 }).catch(() => false)) {
  const annualisedText = await page.evaluate(() => document.body?.innerText ?? "");
  await absoluteTab.click();
  await page.waitForTimeout(1000);
  // After final text extraction, both tabs' data will be in the DOM
}
```

### A3. Expand "Read more" in the About section

```typescript
const readMoreButtons = page.locator('text=/Read\\s*more/i');
const readMoreCount = await readMoreButtons.count();
for (let i = 0; i < readMoreCount; i++) {
  await readMoreButtons.nth(i).click().catch(() => {});
}
await page.waitForTimeout(500);
```

### A4. Strip footer noise before text extraction

The biggest quality issue: chunks 4 and 5 for HDFC Defence Fund are pure Groww footer/navigation links. Fix by removing noise selectors in `page.evaluate`:

```typescript
const removableSelectors = [
  "script", "style", "noscript", "svg", "img",
  "header", "footer", "nav",
  '[class*="footer"]',
  '[class*="Footer"]',
  '[data-testid="footer"]',
  '[class*="breadcrumb"]',
  '[class*="Breadcrumb"]'
];
```

Also add a post-extraction strip in [src/rag/chunk.ts](src/rag/chunk.ts) `normalizeText()` that removes lines matching known noise patterns:

```typescript
const FOOTER_NOISE = /^(Investor Charter|Bug Bounty|Mutual Funds:|Stocks:|Others:|©|Version:|Terms and Conditions|Policies and Procedures|Download Forms|SMART ODR|Privacy Policy|Disclosure|Regulatory)/;
```

### A5. Holding Analysis and Advanced Ratios

These sections on Groww are behind expandable accordions or separate tabs. Add click logic for:
- "Holding Analysis" accordion/tab
- "Advanced Ratios" section (Sharpe, Sortino, Beta, Alpha, Std Dev)

```typescript
for (const label of ["Holding Analysis", "Advanced Ratios"]) {
  const trigger = page.locator(`text="${label}"`).first();
  if (await trigger.isVisible({ timeout: 2000 }).catch(() => false)) {
    await trigger.click();
    await page.waitForTimeout(1000);
  }
}
```

### A6. New `expandInteractiveSections` helper

Consolidate all the above into a single function in [src/rag/scrape.ts](src/rag/scrape.ts):

```typescript
async function expandInteractiveSections(page: Page): Promise<void> {
  // 1. Click "See All" for holdings
  // 2. Click "Absolute returns" tab
  // 3. Click "Read more" buttons
  // 4. Expand "Holding Analysis" and "Advanced Ratios"
  // All with safe try/catch and short timeouts
}
```

Call it between `networkidle` and `page.evaluate`.

---

## Workstream B: Chunker Footer Stripping

In [src/rag/chunk.ts](src/rag/chunk.ts), add a `stripFooterNoise(text: string): string` function called inside `chunkSource` after `normalizeText`. This is a defense-in-depth measure in case the scraper's DOM removal misses some footer text.

The function should:
- Detect the "Looking to invest in mutual funds?" boundary line and truncate everything after it
- Also strip alphabetical index blocks (`Mutual Funds:\nA\nB\nC...`)
- Strip Groww product listings (`Stocks\nF&O\nMTF\nETF...`)

---

## Workstream C: Generic Question Handling ("What is NAV?")

### Current behavior
When a user asks "What is NAV?" without a fund name:
- `extractSchemeName` returns `null`
- `genericFeeExplanationClassification` returns `null` (NAV is not a fee type)
- Heuristic falls through to `scheme_fact` with `extracted_scheme_name: null`
- `buildMetadataFilter` returns `{ content_type: "scheme_fact" }` (no scheme filter)
- Retrieval returns chunks from random funds based on cosine similarity

### Problem
The answer comes from whichever fund's NAV chunk scores highest, without clarifying which fund(s) the answer covers. The user gets a single fund's NAV without knowing other funds exist.

### Fix: Add `needs_clarification` signal

In [src/rag/classify.ts](src/rag/classify.ts):
- Add a new field to `QueryClassification`: `needs_fund_clarification: boolean`
- Set it to `true` when category is `scheme_fact`, `extracted_scheme_name` is `null`, and the query contains scheme-specific terms (NAV, AUM, expense ratio, exit load, holdings, etc.)

In [src/rag/faq.ts](src/rag/faq.ts) `answerQuestion`:
- When `needs_fund_clarification` is true, return a special response with `status: "clarification_needed"` that includes the list of available fund names (from a new helper that reads the source manifest or a hardcoded list from `config/source_urls.json`)
- The response text should say: "Which fund would you like to know the NAV for? I have information on these funds: [list]"

In [src/rag/types.ts](src/rag/types.ts):
- Add `"clarification_needed"` to `FaqAnswerStatus`

In the UI ([src/ui/UnifiedCustomerAssistantClient.tsx](src/ui/UnifiedCustomerAssistantClient.tsx)):
- When the response has `status: "clarification_needed"`, render the fund list as clickable chips that auto-send a follow-up message with the fund name prepended

In the API route ([app/api/smart-sync-faq/route.ts](app/api/smart-sync-faq/route.ts)):
- Accept an optional `available_funds` field or load it server-side from the manifest
- Add a new endpoint `GET /api/smart-sync-faq/funds` that returns the list of fund names from the manifest

---

## Workstream D: Seamless Bidirectional Lane Switching

### Current behavior (in [src/ui/UnifiedCustomerAssistantClient.tsx](src/ui/UnifiedCustomerAssistantClient.tsx))

```typescript
if (looksLikeSchedulerIntent(trimmed) || (activeScheduler && !looksLikeFaqIntent(trimmed))) {
  await sendSchedulerMessage(trimmed);
} else {
  await sendFaqQuestion(trimmed);
}
```

**Problems:**
- Once `activeScheduler` is true, the user can only escape to FAQ by using specific FAQ keywords (`exit load`, `expense ratio`, `lock-in`, `benchmark`, `riskometer`, `fee`, `citation`, etc.)
- Many valid FAQ questions ("What are the holdings?", "What is NAV?", "Tell me about HDFC Defence Fund") don't match `looksLikeFaqIntent` and get routed to the scheduler
- There is no visual indicator of which "lane" is active or how to switch

### Fix: Priority-based intent detection with explicit lane indicator

**Step 1:** Expand `looksLikeFaqIntent` to cover more FAQ patterns:

```typescript
function looksLikeFaqIntent(input: string) {
  return /\b(exit load|expense ratio|lock-?in|benchmark|riskometer|fee|fees|statement|tax|citation|nav\b|aum\b|holdings?|fund objective|investment objective|minimum sip|min sip|scheme|fund manager|returns|ranking|stamp duty|about .+ fund|what is|tell me about)\b/i.test(input);
}
```

**Step 2:** Add an explicit `looksLikeSchedulerExit` check:

```typescript
function looksLikeExitingScheduler(input: string) {
  return /\b(never\s*mind|cancel|stop|go back|switch to faq|search|i have a question)\b/i.test(input);
}
```

**Step 3:** Revise the routing logic:

```typescript
async function routeMessage(rawText: string, displayText = rawText) {
  const trimmed = rawText.trim();
  // ...
  const isFaq = looksLikeFaqIntent(trimmed);
  const isScheduler = looksLikeSchedulerIntent(trimmed);
  const isExiting = looksLikeExitingScheduler(trimmed);

  if (isExiting) {
    // Reset scheduler context and route to FAQ
    setSchedulerContext(undefined);
    await sendFaqQuestion(trimmed);
  } else if (isFaq && !isScheduler) {
    await sendFaqQuestion(trimmed);
  } else if (isScheduler && !isFaq) {
    await sendSchedulerMessage(trimmed);
  } else if (isFaq && isScheduler) {
    // Ambiguous: prioritize current lane
    if (activeScheduler) {
      await sendSchedulerMessage(trimmed);
    } else {
      await sendFaqQuestion(trimmed);
    }
  } else if (activeScheduler) {
    await sendSchedulerMessage(trimmed);
  } else {
    await sendFaqQuestion(trimmed);
  }
}
```

**Step 4:** Add a visual lane indicator pill in the chat composer area:

```tsx
<div className="active-lane-indicator">
  {activeScheduler ? (
    <>
      <span>Advisor Scheduler active</span>
      <button onClick={() => setSchedulerContext(undefined)}>Switch to FAQ</button>
    </>
  ) : (
    <span>Smart-Sync FAQ active</span>
  )}
</div>
```

---

## Workstream E: UI Improvements

### E1. Fund picker chips

Add a new `GET /api/smart-sync-faq/funds` endpoint that reads `config/source_urls.json` and returns `{ funds: [{ source_id, scheme_name }] }`.

In `UnifiedCustomerAssistantClient`, fetch the fund list on mount and render clickable chips above the composer:

```tsx
<div className="fund-chips" aria-label="Available funds">
  {funds.map(fund => (
    <button key={fund.source_id} className="fund-chip"
      onClick={() => routeMessage(`Tell me about ${fund.scheme_name}`)}>
      {fund.scheme_name}
    </button>
  ))}
</div>
```

### E2. Scope disclosure banner

Add a banner below the hero section:

```tsx
<div className="scope-banner">
  I have factual data on {funds.length} approved Groww mutual fund pages and general fee explanations.
  I cannot provide investment advice or account-specific information.
</div>
```

### E3. Prominent "Book Advisor" CTA in sidebar

Replace the generic sidebar note with a clear advisor booking CTA:

```tsx
<div className="sidebar-cta">
  <strong>Need personalized help?</strong>
  <p>Book a call with a Groww advisor. No personal details collected in chat.</p>
  <button onClick={() => routeMessage("I want to book an advisor call")}>
    Book an Advisor
  </button>
</div>
```

### E4. Post-booking next-steps message

After the scheduler returns a `secure_link`, append a follow-up assistant message explaining what happens next:

```tsx
if (data.secure_link) {
  appendMessage({
    role: "assistant",
    lane: "scheduler",
    text: "Your booking request has been submitted. Please fill out the secure details form using the link above. An admin will review and confirm your appointment, and the advisor will receive a calendar hold and email draft."
  });
}
```

---

## Files to modify

| File | Workstream |
|------|-----------|
| [src/rag/scrape.ts](src/rag/scrape.ts) | A (scraper interactions + footer strip) |
| [src/rag/chunk.ts](src/rag/chunk.ts) | B (footer noise stripping in chunker) |
| [src/rag/classify.ts](src/rag/classify.ts) | C (needs_fund_clarification flag) |
| [src/rag/types.ts](src/rag/types.ts) | C (clarification_needed status) |
| [src/rag/faq.ts](src/rag/faq.ts) | C (clarification response with fund list) |
| [app/api/smart-sync-faq/route.ts](app/api/smart-sync-faq/route.ts) | C, E1 (funds endpoint) |
| [src/ui/UnifiedCustomerAssistantClient.tsx](src/ui/UnifiedCustomerAssistantClient.tsx) | D, E (routing, fund chips, scope banner, lane indicator, post-booking) |
| [app/globals.css](app/globals.css) | E (new component styles) |

## New files

| File | Purpose |
|------|---------|
| `app/api/smart-sync-faq/funds/route.ts` | GET endpoint returning fund list from manifest |

## Re-ingestion

After deploying scraper fixes, run `npm run phase3:ingest` with `RAG_FORCE_REINGEST=true` to re-scrape all 14 sources and verify expanded holdings, absolute returns, ratios, and clean chunks.
