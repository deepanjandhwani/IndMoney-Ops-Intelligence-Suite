import { Where } from "chromadb";

import { getApprovedSchemeNames } from "./fund-resolver";
import { GeminiRagClient } from "./gemini";
import { shouldRefuseQuery } from "./safety";
import { QueryCategory, QueryClassification } from "./types";

type ClassifyClient = Pick<GeminiRagClient, "classifyJson">;

export async function classifyQuery(
  query: string,
  client?: ClassifyClient
): Promise<QueryClassification> {
  if (shouldRefuseQuery(query)) {
    return outOfScopeClassification();
  }

  const genericFee = genericFeeExplanationClassification(query);
  if (genericFee) {
    return genericFee;
  }

  const heuristic = heuristicClassification(query);

  if (!client) {
    return heuristic;
  }

  // Skip LLM when heuristic is confident — saves a full classification call
  if (heuristic.confidence >= 0.8) {
    return heuristic;
  }

  const approvedNames = getApprovedSchemeNames();
  try {
    const llmResult = normalizeClassification(await client.classifyJson(classificationPrompt(query, approvedNames)));
    const lower = query.toLowerCase();
    if (llmResult.category === "out_of_scope" && (detectFeeType(lower) || detectTopic(lower))) {
      return heuristic;
    }
    if (llmResult.category === "greeting" && detectTopic(lower)) {
      return heuristic;
    }
    return llmResult;
  } catch {
    return heuristic;
  }
}

export function buildMetadataFilter(classification: QueryClassification): Where | undefined {
  switch (classification.category) {
    case "scheme_fact":
      {
        const filters: Where[] = [{ content_type: "scheme_fact" }];
        if (classification.extracted_scheme_name) {
          filters.push({ scheme_name: classification.extracted_scheme_name });
        } else if (
          classification.query_scope === "multi_fund" &&
          classification.matched_scheme_names?.length
        ) {
          filters.push({
            $or: classification.matched_scheme_names.map((schemeName) => ({
              scheme_name: schemeName
            }))
          });
        }
        return filters.length === 1 ? filters[0] : { $and: filters };
      }
    case "fee_explanation":
      if (classification.extracted_fee_type) {
        return {
          $and: [
            { content_type: "fee_explanation" },
            { fee_type: classification.extracted_fee_type }
          ]
        };
      }
      return { content_type: "fee_explanation" };
    case "process_help":
      return {
        $or: [{ content_type: "help_page" }, { content_type: "regulatory_education" }]
      };
    case "regulatory_education":
      return { content_type: "regulatory_education" };
    case "multi_source": {
      const feeBranch: Where = classification.extracted_fee_type
        ? {
            $and: [
              { content_type: "fee_explanation" },
              { fee_type: classification.extracted_fee_type }
            ]
          }
        : { content_type: "fee_explanation" };

      const hasSchemeScope =
        Boolean(classification.extracted_scheme_name) ||
        (classification.query_scope === "multi_fund" &&
          (classification.matched_scheme_names?.length ?? 0) > 0);

      if (!hasSchemeScope) {
        return {
          $or: [{ content_type: "scheme_fact" }, feeBranch]
        };
      }

      const schemeFilters: Where[] = [{ content_type: "scheme_fact" }];
      if (classification.extracted_scheme_name) {
        schemeFilters.push({ scheme_name: classification.extracted_scheme_name });
      } else if (classification.matched_scheme_names?.length) {
        schemeFilters.push({
          $or: classification.matched_scheme_names.map((schemeName) => ({
            scheme_name: schemeName
          }))
        });
      }
      const schemeBranch =
        schemeFilters.length > 1 ? { $and: schemeFilters } : schemeFilters[0];
      return { $or: [schemeBranch, feeBranch] };
    }
    case "greeting":
    case "out_of_scope":
      return undefined;
  }
}

const GREETING_PATTERN =
  /^(hi|hello|hey|hiya|howdy|yo|sup|wassup|whatsup|what'?s\s*up|hola|namaste|good\s+(morning|afternoon|evening)|thanks|thank\s*you|thx|ty|bye|goodbye|cya|see\s+ya|ok|okay|sure|cool|got\s+it)\b/i;

function heuristicClassification(query: string): QueryClassification {
  const lower = query.toLowerCase();
  if (shouldRefuseQuery(query)) {
    return outOfScopeClassification();
  }

  const trimmed = lower.trim().replace(/[!?.,;:]+$/, "").trim();
  if (GREETING_PATTERN.test(trimmed) && trimmed.split(/\s+/).length <= 6) {
    return greetingClassification();
  }

  const feeType = detectFeeType(lower);
  const topic = detectTopic(lower);

  // multi_source requires BOTH a value question AND an explanation question.
  // "What is the exit load?" alone is scheme_fact (value query).
  // "What is the exit load AND why is it charged?" is multi_source.
  const hasFeeValueTerm = lower.includes("exit load") || lower.includes("expense ratio");
  const hasExplanationIntent = lower.includes("why") || lower.includes("charged") || lower.includes("how does it work") || lower.includes("explain");
  const hasConjunction = lower.includes(" and ") || lower.includes(" also ");
  if (hasFeeValueTerm && hasExplanationIntent) {
    return classification("multi_source", null, feeType, topic, 0.8);
  }
  if (hasFeeValueTerm && hasConjunction && (lower.includes("what is") || lower.includes("what does"))) {
    return classification("multi_source", null, feeType, topic, 0.75);
  }

  if ((lower.includes("why") || lower.includes("charged")) && (feeType || lower.includes("fee"))) {
    return classification("fee_explanation", null, feeType, topic, 0.8);
  }

  if (/(download|statement|capital gains|tax statement|how can i|how do i)/i.test(query)) {
    return classification("process_help", null, feeType, topic, 0.75);
  }

  if (/(elss|lock-in|lock in|sip|mutual fund|riskometer|benchmark|nav\b|aum\b|holdings?|returns?|fund manager|rating|category)/i.test(query)) {
    return classification("scheme_fact", null, feeType, topic, 0.75);
  }

  // When a fee term appears alongside a fund-like phrase, the user wants the
  // fund-specific value (e.g. "exit load on HDFC Defence Fund"), not a
  // generic explanation. Classify as scheme_fact so retrieval targets the
  // fund's chunks.
  const FUND_PHRASE = /\b\w+\s+(funds?|schemes?|mutual\s+funds?|mf)\b/i;
  if (feeType && FUND_PHRASE.test(query)) {
    return classification("scheme_fact", null, feeType, topic, 0.7);
  }

  return classification(feeType ? "fee_explanation" : "scheme_fact", null, feeType, topic, 0.6);
}

function genericFeeExplanationClassification(query: string) {
  const lower = query.toLowerCase();
  const feeType = detectFeeType(lower);
  if (!feeType) {
    return null;
  }
  const FUND_LIKE_PHRASE = /\b\w+\s+(funds?|schemes?|mutual\s+funds?|mf)\b/i;
  if (FUND_LIKE_PHRASE.test(query)) {
    return null;
  }

  const asksForExplanation =
    /\b(what is|what does|meaning|mean|explain|tell me|how does|how is|why|definition)\b/i.test(query) ||
    lower.trim() === feeType.replace(/_/g, " ");

  return asksForExplanation ? classification("fee_explanation", null, feeType, detectTopic(lower), 0.9) : null;
}

function normalizeClassification(raw: Record<string, unknown>): QueryClassification {
  const category = normalizeCategory(raw.category);
  if (category === "out_of_scope") {
    return outOfScopeClassification();
  }
  if (category === "greeting") {
    return greetingClassification();
  }

  return classification(
    category,
    stringOrNull(raw.extracted_scheme_name ?? raw.scheme_name),
    stringOrNull(raw.extracted_fee_type ?? raw.fee_type),
    stringOrNull(raw.extracted_topic ?? raw.topic),
    typeof raw.confidence === "number" ? Math.min(Math.max(raw.confidence, 0), 1) : 0.7
  );
}

function normalizeCategory(value: unknown): QueryCategory {
  if (
    value === "scheme_fact" ||
    value === "fee_explanation" ||
    value === "process_help" ||
    value === "regulatory_education" ||
    value === "multi_source" ||
    value === "greeting" ||
    value === "out_of_scope"
  ) {
    return value;
  }
  const s = typeof value === "string" ? value.toLowerCase() : "";
  if (s.includes("help") || s.includes("process") || s.includes("how_to")) {
    console.warn(`[classify] unknown category "${String(value)}" mapped to process_help`);
    return "process_help";
  }
  if (s.includes("fee") || s.includes("charge") || s.includes("cost")) {
    console.warn(`[classify] unknown category "${String(value)}" mapped to fee_explanation`);
    return "fee_explanation";
  }
  console.warn(`[classify] unknown category "${String(value)}" defaulting to scheme_fact`);
  return "scheme_fact";
}

function classification(
  category: QueryCategory,
  extractedSchemeName: string | null,
  extractedFeeType: string | null,
  extractedTopic: string | null,
  confidence: number
): QueryClassification {
  return {
    category,
    extracted_scheme_name: extractedSchemeName,
    extracted_fee_type: extractedFeeType,
    extracted_topic: extractedTopic?.toLowerCase() ?? null,
    confidence
  };
}

function outOfScopeClassification(): QueryClassification {
  return classification("out_of_scope", null, null, null, 1);
}

function greetingClassification(): QueryClassification {
  return classification("greeting", null, null, null, 1);
}

function detectFeeType(lower: string) {
  if (lower.includes("exit load")) return "exit_load";
  if (lower.includes("expense ratio")) return "expense_ratio";
  if (lower.includes("stamp duty")) return "stamp_duty";
  if (lower.includes("transaction charge")) return "transaction_charge";
  if (lower.includes("gst")) return "gst";
  if (lower.includes("stt")) return "stt";
  return null;
}

function detectTopic(lower: string) {
  if (/\bnav\b/.test(lower)) return "nav";
  if (/\baum\b|asset under management/.test(lower)) return "aum";
  if (/\bholdings?\b|portfolio allocation|sector allocation/.test(lower)) return "holdings";
  if (/\breturns?\b|annualised|absolute returns?|performance|rank/i.test(lower)) return "returns";
  if (/\bfund manager|managed by|who manages/i.test(lower)) return "fund_manager";
  if (/\brating\b|rated|stars?/.test(lower)) return "rating";
  if (/\bcategory\b|type of fund|equity|debt|hybrid|mid.?cap|small.?cap|large.?cap|sectoral|thematic/i.test(lower)) return "fund_overview";
  if (lower.includes("exit load")) return "exit_load";
  if (lower.includes("expense ratio")) return "expense_ratio";
  if (lower.includes("lock-in") || lower.includes("lock in")) return "lock_in";
  if (lower.includes("benchmark")) return "benchmark";
  if (lower.includes("riskometer") || lower.includes("risk-o-meter")) return "riskometer";
  if (lower.includes("minimum sip") || lower.includes("min sip")) return "min_sip";
  if (lower.includes("fund objective") || lower.includes("investment objective")) {
    return "fund_objective";
  }
  if (lower.includes("capital gains")) return "capital_gains_statement";
  if (lower.includes("statement")) return "statement_download";
  if (lower.includes("nominee")) return "nominee";
  if (lower.includes("kyc")) return "kyc";
  return null;
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function classificationPrompt(query: string, approvedFundNames: string[] = []) {
  const fundSection =
    approvedFundNames.length > 0
      ? `\nAvailable funds — match extracted_scheme_name AGGRESSIVELY to the closest fund below. Users frequently misspell, abbreviate, or informally reference funds. Examples of matches you MUST make:
- "farma" / "pharma" / "HC fund" / "healthcare fund" → HDFC Pharma and Healthcare Fund Direct Growth
- "midca" / "midcap" / "mid cap" / "MC fund" → HDFC Mid-Cap Fund Direct Plan Growth Option
- "midcap 150" / "nifty midcap" → HDFC Nifty Midcap 150 Index Fund Direct Growth
- "T&L" / "logistics" / "transport wala" / "transportation" → HDFC Transportation and Logistics Fund Direct Growth
- "BFSI" / "bank fund" / "financial" / "banking fund" → HDFC Banking & Financial Services Fund Direct Growth
- "defence" / "defense" / "military" → HDFC Defence Fund Direct Growth
- "infra" / "infrastructure" → HDFC Infrastructure Fund Direct Plan Growth Option
- "small cap" / "smallcap" / "chhota cap" → HDFC Small Cap Fund Direct Growth Option
- "value fund" → HDFC Value Fund Direct Plan Growth
- "nifty 50" / "nifty50 equal weight" → HDFC Nifty50 Equal Weight Index Fund Direct Growth
- "next 50" / "nifty next 50" → HDFC Nifty Next 50 Index Fund Direct Growth
- "manufacturing" → HDFC Manufacturing Fund Direct Growth

If the user's text is a plausible misspelling (edit distance ≤ 2), abbreviation, informal name, Hinglish reference, or partial match to any fund below, set extracted_scheme_name to that fund's exact string. Set to null ONLY when you are confident NO fund is being referenced at all.\n\nFund list:\n${approvedFundNames.map((f, i) => `${i + 1}. ${f}`).join("\n")}\n`
      : "";

  return `Classify this customer question for a facts-only mutual fund FAQ.

Categories:
- scheme_fact: specific scheme factual attributes such as exit load, expense ratio, lock-in, benchmark, riskometer, NAV, AUM, minimum SIP, fund manager, rating, category, historic/SIP returns, or fund overview. IMPORTANT: "What is the exit load/expense ratio of [fund]?" is scheme_fact — the user wants the VALUE, not an explanation of the concept.
- fee_explanation: why a fee or charge applies. Triggered by "why" + fee term WITHOUT a specific fund value request. IMPORTANT: "why was I charged an exit load / expense ratio / fee" is ALWAYS fee_explanation (or multi_source if combined with a scheme question). It asks about fee logic, NOT about a personal account — never classify it as out_of_scope.
- process_help: how to perform account or document tasks.
- regulatory_education: general mutual fund concepts.
- multi_source: requires BOTH a fund-specific value AND an explanation of why/how the fee works. Example: "What is the exit load for this fund AND why is it charged?" Both a value query and an explanation query in one.
- greeting: casual greeting, hello, hi, hey, thanks, goodbye, chitchat, or any non-question social message.
- out_of_scope: investment advice, fund recommendations, future return predictions, PII lookup, or runtime web search. Do NOT classify fee-related questions as out_of_scope. Asking about historic/past/SIP returns of a fund is scheme_fact, NOT out_of_scope.

Extract scheme_name, fee_type, and topic if present. Use null otherwise.${fundSection}
Question: ${JSON.stringify(query)}

Return JSON only:
{"category":"scheme_fact","extracted_scheme_name":null,"extracted_fee_type":null,"extracted_topic":null,"confidence":0.0}`;
}
