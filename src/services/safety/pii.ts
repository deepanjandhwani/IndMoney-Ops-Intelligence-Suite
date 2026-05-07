export const REDACTION_TOKEN = "[REDACTED]";

export type PiiType =
  | "aadhaar"
  | "account_number"
  | "address"
  | "email"
  | "full_name"
  | "otp"
  | "pan"
  | "phone";

export type PiiFinding = {
  type: PiiType;
  count: number;
};

export type PiiMaskResult = {
  maskedText: string;
  findings: PiiFinding[];
};

type ReplacementRule = {
  type: PiiType;
  pattern: RegExp;
  replacement?: string | ((match: string, ...captures: string[]) => string);
};

const PII_RULES: ReplacementRule[] = [
  {
    type: "email",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
  },
  {
    type: "pan",
    pattern: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g
  },
  {
    type: "aadhaar",
    pattern: /\b[2-9][0-9]{3}[\s-]*[0-9]{4}[\s-]*[0-9]{4}\b/g
  },
  {
    type: "otp",
    pattern: /\b((?:otp|one[-\s]?time password|verification code)\s*(?:is|:|-)?\s*)[0-9]{4,8}\b/gi,
    replacement: `$1${REDACTION_TOKEN}`
  },
  {
    type: "account_number",
    pattern: /\b((?:account|acct|a\/c|bank account|folio)\s*(?:number|no\.?|#)?\s*(?:is|:|-)?\s*)[0-9]{9,18}\b/gi,
    replacement: `$1${REDACTION_TOKEN}`
  },
  {
    type: "email",
    pattern: /\b\w+\s*\[at\]\s*\w+\s*\[dot\]\s*\w+/gi
  },
  {
    type: "phone",
    pattern: /\b(?:\+?91[\s-]?)?[6-9][0-9][0-9\s-]{7,9}[0-9]\b/g
  },
  {
    type: "full_name",
    pattern: /\b((?:my\s+)?(?:full\s+)?name\s*(?:is|:)\s*)[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}\b/g,
    replacement: `$1${REDACTION_TOKEN}`
  },
  {
    type: "full_name",
    pattern: /\b(I\s+am\s+)[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}\b/g,
    replacement: `$1${REDACTION_TOKEN}`
  },
  {
    type: "address",
    pattern: /\b((?:my\s+)?address\s*(?:is|:)|(?:i\s+)?(?:live|reside)\s+at|shipping\s+address\s*:?)\s+([^.\n;]+)/gi,
    replacement: (_match, prefix) => `${prefix} ${REDACTION_TOKEN}`
  }
];

export function maskPii(input: string): PiiMaskResult {
  const counts = new Map<PiiType, number>();
  let maskedText = input;

  for (const rule of PII_RULES) {
    maskedText = maskedText.replace(rule.pattern, (...args) => {
      counts.set(rule.type, (counts.get(rule.type) ?? 0) + 1);
      const captures = args.slice(1, -2);

      if (typeof rule.replacement === "function") {
        return rule.replacement(args[0], ...captures);
      }

      return applyCaptureReplacement(rule.replacement ?? REDACTION_TOKEN, captures);
    });
  }

  return {
    maskedText,
    findings: Array.from(counts.entries()).map(([type, count]) => ({
      type,
      count
    }))
  };
}

export function containsPii(input: string) {
  return maskPii(input).findings.length > 0;
}

function applyCaptureReplacement(replacement: string, captures: string[]) {
  return replacement.replace(/\$(\d+)/g, (_match, index) => captures[Number(index) - 1] ?? "");
}
