import { readFile } from "node:fs/promises";

import {
  ContentType,
  ScrapeStatus,
  SourceConfig,
  SourceManifest,
  SourceType
} from "./types";

const SOURCE_TYPES = new Set<SourceType>(["official_url", "static_fee_explainer"]);
const CONTENT_TYPES = new Set<ContentType>([
  "scheme_fact",
  "fee_explanation",
  "regulatory_education",
  "help_page"
]);
const SCRAPE_STATUSES = new Set<ScrapeStatus>(["success", "failed", "pending"]);

export async function loadSourceManifest(path: string): Promise<SourceManifest> {
  const raw = await readFile(path, "utf8");
  const trimmed = raw.trim();
  const manifest = trimmed.startsWith("{")
    ? (JSON.parse(trimmed) as SourceManifest)
    : legacyUrlListToManifest(trimmed);

  return validateSourceManifest(manifest);
}

export async function loadFeeExplainerSource(path: string): Promise<SourceConfig> {
  const raw = await readFile(path, "utf8");
  const parsed = parseFeeExplainer(raw);
  return validateSource({
    source_id: "fee_static_001",
    url: null,
    source_type: "static_fee_explainer",
    content_type: "fee_explanation",
    title: "Approved Fee Explainer",
    last_checked: todayIsoDate(),
    scrape_status: "pending",
    ...parsed
  });
}

export function validateSourceManifest(manifest: SourceManifest): SourceManifest {
  if (!manifest || !Array.isArray(manifest.sources)) {
    throw new Error("Source manifest must contain a sources array.");
  }

  const seenSourceIds = new Set<string>();
  const seenUrls = new Set<string>();
  const sources = manifest.sources.map((source) => {
    const validated = validateSource(source);

    if (seenSourceIds.has(validated.source_id)) {
      throw new Error(`Duplicate source_id in source manifest: ${validated.source_id}`);
    }
    seenSourceIds.add(validated.source_id);

    if (validated.url) {
      if (seenUrls.has(validated.url)) {
        throw new Error(`Duplicate URL in source manifest: ${validated.url}`);
      }
      seenUrls.add(validated.url);
    }

    return validated;
  });

  return { sources };
}

function validateSource(source: SourceConfig): SourceConfig {
  if (!source.source_id?.trim()) {
    throw new Error("Source entry missing source_id.");
  }
  if (!SOURCE_TYPES.has(source.source_type)) {
    throw new Error(`Unsupported source_type for ${source.source_id}.`);
  }
  if (!CONTENT_TYPES.has(source.content_type)) {
    throw new Error(`Unsupported content_type for ${source.source_id}.`);
  }
  if (!source.title?.trim()) {
    throw new Error(`Source ${source.source_id} missing title.`);
  }
  if (!source.last_checked?.trim()) {
    throw new Error(`Source ${source.source_id} missing last_checked.`);
  }
  if (!SCRAPE_STATUSES.has(source.scrape_status)) {
    throw new Error(`Source ${source.source_id} has invalid scrape_status.`);
  }
  if (source.source_type === "official_url" && !source.url) {
    throw new Error(`Official source ${source.source_id} must include a URL.`);
  }

  return source;
}

function legacyUrlListToManifest(raw: string): SourceManifest {
  const uniqueUrls = Array.from(
    new Set(raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))
  );

  return {
    sources: uniqueUrls.map((url, index) => ({
      source_id: `src_${String(index + 1).padStart(3, "0")}`,
      url,
      source_type: "official_url",
      content_type: "scheme_fact",
      title: titleFromUrl(url),
      scheme_name: titleFromUrl(url),
      last_checked: todayIsoDate(),
      scrape_status: "pending"
    }))
  };
}

function parseFeeExplainer(raw: string): Partial<SourceConfig> {
  const trimmed = raw.trim();
  if (isUrl(trimmed)) {
    return {
      url: trimmed,
      title: "Approved Fee Explainer"
    };
  }

  if (!trimmed.startsWith("---")) {
    return {
      url: null,
      title: "Approved Fee Explainer"
    };
  }

  const endIndex = trimmed.indexOf("\n---", 3);
  if (endIndex === -1) {
    throw new Error("Fee explainer frontmatter is not closed.");
  }

  const frontmatter = trimmed.slice(3, endIndex).trim();
  const metadata: Record<string, string> = {};
  for (const line of frontmatter.split(/\r?\n/)) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    metadata[key] = value;
  }

  return {
    source_id: metadata.source_id,
    source_type: metadata.source_type as SourceType,
    content_type: metadata.content_type as ContentType,
    title: metadata.title,
    url: metadata.url || null,
    last_checked: metadata.last_checked,
    scrape_status: metadata.scrape_status as ScrapeStatus
  };
}

function titleFromUrl(url: string) {
  const slug = url.split("/").filter(Boolean).at(-1) ?? "source";
  return slug
    .replace(/-\d+$/, "")
    .split("-")
    .filter((part) => !["direct", "growth", "option", "plan"].includes(part))
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function isUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}
