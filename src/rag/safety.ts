import { containsPii } from "../services/safety/pii";

// Exact refusal string per docs/rules.md and docs/evals.md §2, with the M1
// educational link appended. Keep this in lockstep with both docs; the eval
// runner asserts `row.answer === SAFETY_REFUSAL`.
export const SAFETY_REFUSAL =
  "I can't provide investment advice, future return predictions, or handle personal account information. I can help with facts from approved sources, such as NAV, AUM, exit load, expense ratio, lock-in, benchmark, riskometer, historic returns, fund manager, rating, fee explanation, or statement download steps. For investor education, see https://investor.sebi.gov.in/.";

export const GREETING_RESPONSE =
  "Hi! I'm the Smart-Sync FAQ assistant for Groww mutual funds. Ask me about NAV, AUM, exit load, expense ratio, benchmark, riskometer, returns, fund manager, rating, or any other facts from approved sources. You can also use the fund filters below to narrow your search.";

export const NO_RESULTS_MESSAGE =
  "I don't have enough information from approved sources to answer this question. I can help with source-backed facts such as NAV, AUM, holdings, exit load, expense ratio, lock-in period, benchmark, riskometer, historic returns, fund manager, rating, fee explanations, or statement download steps when those facts are present in the indexed approved chunks.";

const ADVICE_PATTERNS = [
  // English advice phrasings
  /\bshould\s+i\s+(buy|sell|hold|invest|switch|redeem)\b/i,
  /\b(can|may)\s+i\s+(buy|sell|invest|hold|switch|redeem)\b/i,
  /\b(which|what)\s+fund\s+(should|will|can|is\s+best)\b/i,
  /\b(tell|suggest|advise|advice)\s+me\s+(which|what)\s+fund\b/i,
  /\brecommend(?:ation|ed|s)?\b/i,
  /\bbest\s+(fund|scheme|investment|amc)\b/i,
  /\bsafe(?:st)?\s+(fund|scheme|investment)\b/i,
  /\breturn\s+prediction\b/i,
  /\b(guarantee|assured|promised?)\s+\d{1,3}%\s+returns?\b/i,
  /\bportfolio\s+advice\b/i,
  /\b(is it|is this)\s+(a\s+)?good\s+(fund|investment|scheme)\b/i,
  /\bworth\s+investing\b/i,
  /\b(give|generate|earn|make)\s+(me\s+)?(\d{1,3}%|\d{1,3}\s+percent|high)\s+returns?\b/i,
  // Hinglish / Hindi-Latin advice phrasings
  /\bkaun(?:sa|si|sha)\s+(fund|scheme)\b/i,
  /\biss?\s+fund\s+(?:me|mein|main)\s+(?:invest|paisa\s+(?:lag|laga|daal))/i,
  /\b(le|kharid|kharee?d|buy)\s+(sakta|sakti|sakte|loon|lun|le)\s+(hu|hoon|hai)\b/i,
  /\b(?:fund|scheme)\s+(?:lag|laga|daal)(?:o|na|du|doon)?\b/i,
  /\bmujhe\s+(?:konsa|kaunsa|which)?\s*(?:fund|scheme)\s+(?:lena|leni|chahiye|le|invest)/i,
  /\bpaise\s+(?:kahan|kaha|kha|kaise)\s+(?:invest|lag(?:ao|aoon|aau))/i
];

const PII_REQUEST_PATTERNS = [
  /\b(customer|user|client).*(phone|mobile|email|pan|aadhaar|account number)\b/i,
  /\b(phone|mobile|email|pan|aadhaar|account number).*(customer|user|client)\b/i,
  /\bceo'?s?\s+email\b/i,
  /\bcontact details\b/i,
  /\b(search|look up|find).*(phone|email|pan|aadhaar|account)\b/i
];

const RUNTIME_WEB_SEARCH_PATTERNS = [
  /\b(search|google|browse)\s+(online|the web|the internet)\b/i,
  /\blook\s+up\s+(online|on the web|on the internet)\b/i,
  /\blive\s+(price|nav|return)\b/i
];

export function shouldRefuseQuery(query: string) {
  return (
    ADVICE_PATTERNS.some((pattern) => pattern.test(query)) ||
    PII_REQUEST_PATTERNS.some((pattern) => pattern.test(query)) ||
    RUNTIME_WEB_SEARCH_PATTERNS.some((pattern) => pattern.test(query))
  );
}

const ANSWER_ADVICE_PATTERNS = [
  /\byou should (buy|sell|hold|invest|redeem|switch)\b/i,
  /\byou may want to (buy|sell|hold|invest|redeem|switch)\b/i,
  /\bi recommend\b/i,
  /\bconsider (buying|selling|holding|investing|redeeming|switching)\b/i,
  /\bhold for better returns\b/i,
  /\b(buy|sell|invest in) this (fund|scheme)\b/i,
  /\bdon'?t (buy|sell|invest|redeem)\b/i,
  /\bavoid (buying|selling|investing|redeeming)\b/i,
  /\b(solid choice|good choice)\b/i,
  /\bthis (fund|scheme) is (attractive|promising|favorable)\b/i
];

export function answerHasSafetyIssue(answer: string) {
  return (
    containsPii(answer) ||
    ANSWER_ADVICE_PATTERNS.some((pattern) => pattern.test(answer))
  );
}
