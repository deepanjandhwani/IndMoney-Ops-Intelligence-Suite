import { createHash } from "node:crypto";

import { ChunkDocument, ChunkMetadata, SourceConfig } from "./types";

const SCHEME_SECTION_TYPES = [
  "exit_load",
  "expense_ratio",
  "lock_in",
  "benchmark",
  "riskometer",
  "min_sip",
  "fund_objective",
  "nav",
  "aum",
  "returns",
  "fund_manager",
  "fund_overview",
  "holdings"
] as const;

const FEE_TYPES = [
  "exit_load",
  "expense_ratio",
  "stamp_duty",
  "transaction_charge",
  "gst",
  "stt"
] as const;

// Token-aware chunk caps (per docs/architecture/ragA.md §2.2). We use a cheap
// proxy: 1 token ≈ 1 short word OR ≈ 1 punctuation/number group. This avoids
// undershoot (long-word scheme docs) and overshoot (number-heavy fee tables)
// that the prior pure-word counter exhibited. The numeric ceilings (≈ 520
// scheme tokens / ≈ 390 fee tokens) match the spec's 400/300 word ceilings
// once you include the 1.3× token-per-word factor.
const MAX_SCHEME_TOKENS = 520;
const MAX_FEE_TOKENS = 390;
const MIN_CHUNK_TOKENS = 8;

type TextSection = {
  heading: string;
  text: string;
};

export function chunkSource(source: SourceConfig, rawText: string): ChunkDocument[] {
  const normalizedText = normalizeText(rawText);
  if (!normalizedText) {
    return [];
  }

  const cleanedText = stripFooterNoise(normalizedText);
  if (!cleanedText) {
    return [];
  }

  const contentHash = sha256(cleanedText);
  const maxTokens = source.content_type === "fee_explanation" ? MAX_FEE_TOKENS : MAX_SCHEME_TOKENS;
  const sections = splitIntoSections(cleanedText, source.content_type);
  const chunks: ChunkDocument[] = [];

  for (const section of sections) {
    for (const text of splitByTokenLimit(section.text, maxTokens)) {
      if (approxTokenCount(text) < MIN_CHUNK_TOKENS) {
        continue;
      }

      const metadata = metadataForChunk(source, contentHash, chunks.length, section, text);
      chunks.push({
        id: chunkId(source.source_id, contentHash, chunks.length),
        text,
        metadata
      });
    }
  }

  return chunks;
}

export function normalizeText(text: string) {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

const FOOTER_NOISE_LINE =
  /^(Investor Charter|Bug Bounty|Mutual Funds:|Stocks:|Others:|©|Version:|Terms and Conditions|Policies and Procedures|Download Forms|SMART ODR|Privacy Policy|Disclosure|Regulatory|Stocks$|F&O$|MTF$|ETF$)/;

export function stripFooterNoise(text: string): string {
  const lines = text.split("\n");

  // Truncate everything from the "Looking to invest" boundary
  const boundary = lines.findIndex((line) =>
    /^Looking to invest in mutual funds\??$/i.test(line.trim())
  );
  const clipped = boundary >= 0 ? lines.slice(0, boundary) : lines;

  let inAlphaIndexBlock = false;

  return clipped
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;

      if (FOOTER_NOISE_LINE.test(trimmed)) return false;

      // Detect alphabetical index blocks (single capital letter lines like A, B, C…)
      if (/^[A-Z]$/.test(trimmed)) {
        inAlphaIndexBlock = true;
        return false;
      }
      if (inAlphaIndexBlock && /^[A-Za-z0-9\s&]+$/.test(trimmed) && trimmed.length < 40) {
        return false;
      }
      inAlphaIndexBlock = false;

      return true;
    })
    .join("\n")
    .trim();
}

function splitIntoSections(text: string, contentType: SourceConfig["content_type"]): TextSection[] {
  const knownSections = splitByKnownSectionHeadings(text, contentType);
  if (knownSections.length > 1) {
    return knownSections;
  }

  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const sections: TextSection[] = [];
  let heading = "General";
  let buffer: string[] = [];

  for (const line of lines) {
    if (isLikelyHeading(line) && buffer.length > 0) {
      sections.push({ heading, text: withHeading(heading, buffer.join("\n")) });
      heading = line;
      buffer = [];
      continue;
    }

    if (isLikelyHeading(line)) {
      heading = line;
      continue;
    }

    buffer.push(line);
  }

  if (buffer.length > 0) {
    sections.push({ heading, text: withHeading(heading, buffer.join("\n")) });
  }

  return sections.length > 0 ? sections : [{ heading: "General", text }];
}

function splitByKnownSectionHeadings(
  text: string,
  contentType: SourceConfig["content_type"]
): TextSection[] {
  if (contentType === "scheme_fact") {
    const structured = extractStructuredSections(text);
    if (structured.length > 0) {
      return structured;
    }
  }

  const headingPattern =
    contentType === "fee_explanation"
      ? "(Exit Load|Expense Ratio|Stamp Duty|Transaction Charge|GST|STT|General Fee)"
      : "(Exit Load|Expense Ratio|Lock[- ]?In|Benchmark|Riskometer|Risk-O-Meter|Minimum SIP|Min SIP|Fund Objective|Investment Objective|NAV|AUM)";
  const pattern = new RegExp(`(^|\\n)${headingPattern}(?=\\n)`, "gi");
  const matches = Array.from(text.matchAll(pattern));
  if (matches.length <= 1) {
    return [];
  }

  return matches.map((match, index) => {
    const headingStart = (match.index ?? 0) + match[1].length;
    const nextStart =
      index + 1 < matches.length ? (matches[index + 1].index ?? text.length) : text.length;
    const chunkText = text.slice(headingStart, nextStart).trim();
    const heading = match[2];
    return { heading, text: chunkText };
  });
}

/**
 * Extracts structured sections from Groww mutual fund pages using regex
 * patterns on the scraped text. Produces dedicated chunks for key data
 * points that the generic heading-split misses (returns, rankings, fund
 * managers, category tags, rating, min investments).
 */
function extractStructuredSections(text: string): TextSection[] {
  const sections: TextSection[] = [];

  // 1. Fund overview: NAV, AUM, expense ratio, rating, min SIP in one block
  const navMatch = text.match(/NAV[:\s]*[\d].*?\n(₹[\d,.]+)/);
  const aumMatch = text.match(/Fund size\s*\(AUM\)\s*\n\s*(₹[\d,.]+\s*Cr)/);
  const erMatch = text.match(/Expense ratio\s*\n\s*([\d.]+%)/);
  const ratingMatch = text.match(/Rating\s*\n\s*(\S+)/);
  const sipMatch = text.match(/Min\.\s*for\s*SIP\s*\n\s*(₹[\d,.]+)/);

  if (navMatch || aumMatch) {
    const parts: string[] = ["Fund Overview"];
    if (navMatch) parts.push(`NAV: ${navMatch[1]} (${navMatch[0].match(/NAV[:\s]*([\d].*)/)?.[1]?.trim() ?? ""})`);
    if (aumMatch) parts.push(`AUM: ${aumMatch[1]}`);
    if (erMatch) parts.push(`Expense Ratio: ${erMatch[1]}`);
    if (ratingMatch && ratingMatch[1] !== "--") parts.push(`Rating: ${ratingMatch[1]} stars`);
    if (ratingMatch && ratingMatch[1] === "--") parts.push("Rating: Not rated");
    if (sipMatch) parts.push(`Minimum SIP: ${sipMatch[1]}`);
    sections.push({ heading: "Fund Overview", text: parts.join("\n") });
  }

  // 2. Returns & Rankings table
  const returnsBlock = text.match(
    /(?:Returns and rankings|Annualised returns|Absolute returns)[\s\S]*?Fund returns\s*\|([^\n]+)\n.*?Category average[^\n]*\|([^\n]+)\n.*?Rank[^\n]*\|([^\n]+)/i
  );
  if (returnsBlock) {
    const fundReturns = returnsBlock[1].trim();
    const categoryAvg = returnsBlock[2].trim();
    const rank = returnsBlock[3].trim();
    const returnsText = [
      "Returns and Rankings",
      `Fund returns: ${fundReturns}`,
      `Category average: ${categoryAvg}`,
      `Category rank: ${rank}`
    ].join("\n");
    sections.push({ heading: "Returns and Rankings", text: returnsText });
  }

  // 3. SIP return calculator
  const sipReturns = text.match(
    /Return calculator[\s\S]*?(Over the past[\s\S]*?)(?=\n##|\nHoldings|\nSee All)/i
  );
  if (sipReturns) {
    const cleaned = sipReturns[1]
      .replace(/\|[- ]+\|[- ]+\|[- ]+\|[- ]+\|[- ]+\|/g, "")
      .replace(/\n{2,}/g, "\n")
      .trim();
    if (cleaned.length > 30) {
      sections.push({ heading: "SIP Returns", text: `SIP Return Calculator\n${cleaned}` });
    }
  }

  // 4. Minimum investments
  const min1st = text.match(/Min\.\s*for\s*1st\s*investment\s*\n\s*(.+)/i);
  const min2nd = text.match(/Min\.\s*for\s*2nd\s*investment\s*\n\s*(.+)/i);
  if (min1st || min2nd) {
    const parts = ["Minimum Investments"];
    if (min1st) parts.push(`Minimum for 1st investment: ${min1st[1].trim()}`);
    if (min2nd) parts.push(`Minimum for 2nd investment: ${min2nd[1].trim()}`);
    if (sipMatch) parts.push(`Minimum for SIP: ${sipMatch[1]}`);
    sections.push({ heading: "Minimum SIP", text: parts.join("\n") });
  }

  // 5. Fund manager(s) — extract name, education, experience
  const fmBlocks = [...text.matchAll(
    /(?:^|\n)([A-Z]{2})([\w\s]+?)(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4})\s*-\s*Present.*?\n(?:Education\s*\n(.+?)(?:\n))?(?:Experience\s*\n(.+?)(?:\n(?:Also manages|$)))/gm
  )];
  if (fmBlocks.length > 0) {
    const parts = ["Fund Management"];
    for (const fm of fmBlocks) {
      const name = fm[2].trim();
      const edu = fm[3]?.trim() ?? "";
      const exp = fm[4]?.trim() ?? "";
      parts.push(`Fund Manager: ${name}`);
      if (edu) parts.push(`Education: ${edu}`);
      if (exp) parts.push(`Experience: ${exp}`);
      parts.push("");
    }
    sections.push({ heading: "Fund Management", text: parts.join("\n").trim() });
  }

  // 6. About section (contains category, risk, launch date, investment objective)
  const aboutMatch = text.match(
    /About\s+.+?\n\n?([\s\S]*?)(?:\n####|\nFund benchmark|\n##\s)/i
  );
  if (aboutMatch) {
    const aboutText = aboutMatch[1].trim();
    if (aboutText.length > 50) {
      sections.push({ heading: "Investment Objective", text: aboutText });
    }
  }

  // 7. Fund benchmark
  const benchmarkMatch = text.match(/Fund\s*benchmark\s*\n?\s*(.+)/i);
  if (benchmarkMatch) {
    sections.push({ heading: "Benchmark", text: `Fund Benchmark: ${benchmarkMatch[1].trim()}` });
  }

  // 8. Exit load, stamp duty, tax
  const exitBlock = text.match(
    /Exit load,?\s*stamp duty and tax[\s\S]*?(?=\n(?:Fund management|Check past data|###\s(?!Exit)))/i
  ) ?? text.match(
    /Exit [Ll]oad\s*\n[\s\S]*?(?=\n(?:Stamp duty|Fund management|###\s(?!Exit|Stamp)))/i
  );
  if (exitBlock) {
    sections.push({ heading: "Exit Load", text: exitBlock[0].trim() });
  }

  // 9. Holdings (top 10 only to keep chunk size manageable)
  const holdingsMatch = text.match(/Holdings\s*\(\d+\)[\s\S]*?(?=\nSee All|\n##\s|\nMinimum investments)/i);
  if (holdingsMatch) {
    const lines = holdingsMatch[0].split("\n");
    const holdingLines = lines.filter(l => l.includes("|") && !l.match(/^[| -]+$/));
    const top = holdingLines.slice(0, 12); // header + 10 holdings + buffer
    if (top.length > 2) {
      sections.push({ heading: "Holdings", text: top.join("\n") });
    }
  }

  return sections;
}

function splitByTokenLimit(text: string, maxTokens: number) {
  const paragraphs = text.split(/\n{2,}|\n(?=[A-Z0-9][^.\n]{0,80}:?)/).map((part) => part.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current: string[] = [];

  for (const paragraph of paragraphs) {
    const next = [...current, paragraph].join("\n");
    if (approxTokenCount(next) <= maxTokens) {
      current.push(paragraph);
      continue;
    }

    if (current.length > 0) {
      chunks.push(current.join("\n"));
      current = [];
    }

    if (approxTokenCount(paragraph) <= maxTokens) {
      current.push(paragraph);
    } else {
      chunks.push(...splitLongParagraph(paragraph, maxTokens));
    }
  }

  if (current.length > 0) {
    chunks.push(current.join("\n"));
  }

  return chunks;
}

// Splits a paragraph that exceeds maxTokens. Prefers sentence boundaries so
// fee_explanation chunks don't fragment a definition mid-clause; falls back
// to a hard word-window cap when a single sentence still exceeds maxTokens.
function splitLongParagraph(text: string, maxTokens: number) {
  const sentences = splitIntoSentences(text);
  if (sentences.length <= 1) {
    return splitByFixedWordWindow(text, maxTokens);
  }

  const chunks: string[] = [];
  let current: string[] = [];
  for (const sentence of sentences) {
    const candidate = [...current, sentence].join(" ");
    if (approxTokenCount(candidate) <= maxTokens) {
      current.push(sentence);
      continue;
    }
    if (current.length > 0) {
      chunks.push(current.join(" "));
      current = [];
    }
    if (approxTokenCount(sentence) <= maxTokens) {
      current.push(sentence);
    } else {
      chunks.push(...splitByFixedWordWindow(sentence, maxTokens));
    }
  }
  if (current.length > 0) {
    chunks.push(current.join(" "));
  }
  return chunks;
}

function splitIntoSentences(text: string): string[] {
  // Conservative sentence split: terminator (.!?) followed by whitespace + capital
  // letter, with abbreviations like "e.g.", "i.e.", "Mr.", "vs.", "Inc." preserved.
  const safelist = /(?:e\.g|i\.e|vs|Mr|Mrs|Ms|Dr|Inc|Ltd|St|No|Sr|Jr|U\.S|U\.K)\.$/;
  const tokens = text.split(/(?<=[.!?])\s+(?=[A-Z0-9"\(])/);
  const merged: string[] = [];
  for (const token of tokens) {
    if (merged.length > 0 && safelist.test(merged[merged.length - 1])) {
      merged[merged.length - 1] = `${merged[merged.length - 1]} ${token}`;
    } else {
      merged.push(token);
    }
  }
  return merged.map((s) => s.trim()).filter(Boolean);
}

function splitByFixedWordWindow(text: string, maxTokens: number) {
  // Convert tokens-per-window back to a word-window using the inverse of the
  // token approximator (~ 1 word per 1.3 tokens).
  const wordWindow = Math.max(1, Math.floor(maxTokens / 1.3));
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  for (let index = 0; index < words.length; index += wordWindow) {
    chunks.push(words.slice(index, index + wordWindow).join(" "));
  }
  return chunks;
}

function metadataForChunk(
  source: SourceConfig,
  contentHash: string,
  chunkIndex: number,
  section: TextSection,
  text: string
): ChunkMetadata {
  const metadata: ChunkMetadata = {
    source_id: source.source_id,
    source_type: source.source_type,
    content_type: source.content_type,
    title: source.title,
    // Propagate the source URL so fee_explanation citations can link to the
    // public Groww explainer (per docs/rules.md "URL where claims rely on
    // official content"). Falls back to null when frontmatter has no URL.
    url: source.url ?? null,
    last_checked: source.last_checked,
    content_hash: contentHash,
    chunk_index: chunkIndex
  };

  if (source.scheme_name) {
    metadata.scheme_name = source.scheme_name;
  }
  if (source.topic) {
    metadata.topic = source.topic;
  }

  if (source.content_type === "scheme_fact") {
    metadata.section_type = detectSchemeSection(`${section.heading}\n${text}`);
  }
  if (source.content_type === "fee_explanation") {
    metadata.fee_type = source.fee_type ?? detectFeeType(`${section.heading}\n${text}`);
    metadata.scenario = section.heading;
  }

  return metadata;
}

function detectSchemeSection(text: string) {
  const lower = text.toLowerCase();
  if (lower.startsWith("fund overview")) return "fund_overview";
  if (lower.startsWith("returns and rankings") || lower.includes("fund returns")) return "returns";
  if (lower.startsWith("sip return")) return "returns";
  if (lower.startsWith("fund manage") || lower.includes("fund manager")) return "fund_manager";
  if (lower.startsWith("holdings")) return "holdings";
  if (lower.includes("exit load")) return "exit_load";
  if (lower.includes("expense ratio")) return "expense_ratio";
  if (lower.includes("lock-in") || lower.includes("lock in")) return "lock_in";
  if (lower.includes("benchmark")) return "benchmark";
  if (lower.includes("riskometer") || lower.includes("risk-o-meter")) return "riskometer";
  if (lower.includes("minimum sip") || lower.includes("min sip") || lower.includes("minimum investment")) return "min_sip";
  if (lower.includes("investment objective") || lower.includes("fund objective")) return "fund_objective";
  if (lower.includes("nav")) return "nav";
  if (lower.includes("aum") || lower.includes("asset under management")) return "aum";
  return "general";
}

function detectFeeType(text: string) {
  const lower = text.toLowerCase();
  if (lower.includes("exit load")) return "exit_load";
  if (lower.includes("expense ratio")) return "expense_ratio";
  if (lower.includes("stamp duty")) return "stamp_duty";
  if (lower.includes("transaction charge")) return "transaction_charge";
  if (lower.includes("gst")) return "gst";
  if (lower.includes("stt") || lower.includes("securities transaction tax")) return "stt";
  return "general_fee";
}

function isLikelyHeading(line: string) {
  const compact = line.trim();
  if (compact.length < 3 || compact.length > 90) {
    return false;
  }

  const lower = compact.toLowerCase();
  const keywordMatch = [...SCHEME_SECTION_TYPES, ...FEE_TYPES].some((keyword) =>
    lower.includes(keyword.replace(/_/g, " "))
  );
  if (keywordMatch) {
    return true;
  }

  const words = compact.split(/\s+/);
  return words.length <= 8 && !/[.!?]$/.test(compact) && /^[A-Z0-9]/.test(compact);
}

function withHeading(heading: string, text: string) {
  return heading === "General" ? text : `${heading}\n${text}`;
}

function chunkId(sourceId: string, contentHash: string, chunkIndex: number) {
  return sha256(`${sourceId}:${contentHash}:${chunkIndex}`).slice(0, 32);
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function wordCount(text: string) {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Cheap token approximation. ~1 token per 4 chars for typical English, but
 * with a per-word floor of 1 token to handle CJK / numbers correctly. This
 * matches the magnitude of Gemini / GPT tokenizers without pulling in a
 * heavy native binding (we run inside a small CI image).
 */
function approxTokenCount(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  const charBased = Math.ceil(trimmed.length / 4);
  const wordBased = trimmed.split(/\s+/).filter(Boolean).length;
  // Fee tables and figures use punctuation/digits that tokenize per group.
  return Math.max(charBased, wordBased);
}
