import { readFile } from "node:fs/promises";

import { VectorStore, createChromaVectorStore } from "./chroma";
import { chunkSource, normalizeText } from "./chunk";
import { createGeminiRagClient, GeminiRagClient } from "./gemini";
import { loadFeeExplainerSource, loadSourceManifest } from "./manifest";
import { scrapeUrl } from "./scrape";
import { EmbeddedChunk, SourceConfig, SMART_SYNC_COLLECTION } from "./types";

export type IngestionConfig = {
  sourceManifestPath: string;
  feeExplainerPath: string;
  chromaCollection: string;
  forceReIngest: boolean;
};

export type IngestionResult = {
  total_sources: number;
  sources_scraped: number;
  sources_failed: number;
  chunks_created: number;
  chunks_upserted: number;
  stale_chunks_removed: number;
  errors: { source_id: string; error: string }[];
  duration_ms: number;
};

export type RunRagIngestionDependencies = {
  vectorStore?: VectorStore;
  llm?: Pick<GeminiRagClient, "embedDocuments">;
  scrape?: (url: string) => Promise<string>;
};

export async function runRagIngestion(
  config: Partial<IngestionConfig> = {},
  dependencies: RunRagIngestionDependencies = {}
): Promise<IngestionResult> {
  const startedAt = Date.now();
  const resolvedConfig = resolveConfig(config);
  const manifest = await loadSourceManifest(resolvedConfig.sourceManifestPath);
  const feeExplainer = await loadFeeExplainerSource(resolvedConfig.feeExplainerPath);
  const sources = [...manifest.sources, feeExplainer];
  const vectorStore =
    dependencies.vectorStore ??
    (await createChromaVectorStore({
      ...process.env,
      CHROMA_COLLECTION: resolvedConfig.chromaCollection
    }));
  const llm = dependencies.llm ?? createGeminiRagClient();
  const scrape = dependencies.scrape ?? scrapeUrl;
  const result: IngestionResult = {
    total_sources: sources.length,
    sources_scraped: 0,
    sources_failed: 0,
    chunks_created: 0,
    chunks_upserted: 0,
    stale_chunks_removed: 0,
    errors: [],
    duration_ms: 0
  };

  for (let si = 0; si < sources.length; si++) {
    const source = sources[si];
    const label = `[${si + 1}/${sources.length}] ${source.source_id} (${source.title?.slice(0, 40)})`;
    try {
      console.log(`${label} scraping...`);
      const rawText = await sourceTextFor(source, resolvedConfig.feeExplainerPath, scrape);
      const chunks = chunkSource(source, rawText);
      if (chunks.length === 0) {
        throw new Error("Source produced no indexable chunks.");
      }

      result.sources_scraped += 1;
      result.chunks_created += chunks.length;
      console.log(`${label} chunked → ${chunks.length} chunks`);

      const contentHash = chunks[0].metadata.content_hash;
      const existingHash = await vectorStore.getSourceContentHash(source.source_id);
      if (!resolvedConfig.forceReIngest && existingHash === contentHash) {
        console.log(`${label} unchanged, skipping embed`);
        continue;
      }

      console.log(`${label} embedding ${chunks.length} chunks...`);
      const embeddings = await llm.embedDocuments(chunks.map((chunk) => chunk.text));
      if (embeddings.length !== chunks.length) {
        throw new Error("Embedding API returned a different number of embeddings than chunks.");
      }

      await vectorStore.deleteBySourceId(source.source_id);
      await vectorStore.upsert(
        chunks.map<EmbeddedChunk>((chunk, index) => ({
          ...chunk,
          embedding: embeddings[index]
        }))
      );
      result.chunks_upserted += chunks.length;
      console.log(`${label} ✓ upserted`);
    } catch (error) {
      result.sources_failed += 1;
      const msg = error instanceof Error ? error.message : "Unknown ingestion error";
      result.errors.push({ source_id: source.source_id, error: msg });
      console.error(`${label} ✗ ${msg}`);
    }
  }

  result.stale_chunks_removed = await vectorStore.deleteSourcesExcept(
    new Set(sources.map((source) => source.source_id))
  );
  result.duration_ms = Date.now() - startedAt;
  return result;
}

function resolveConfig(config: Partial<IngestionConfig>): IngestionConfig {
  return {
    sourceManifestPath: config.sourceManifestPath ?? "config/source_urls.json",
    feeExplainerPath: config.feeExplainerPath ?? "config/static_fee_explainer.md",
    chromaCollection:
      config.chromaCollection ?? process.env.CHROMA_COLLECTION ?? SMART_SYNC_COLLECTION,
    forceReIngest: config.forceReIngest ?? process.env.RAG_FORCE_REINGEST === "true"
  };
}

async function sourceTextFor(
  source: SourceConfig,
  feeExplainerPath: string,
  scrape: (url: string) => Promise<string>
) {
  if (source.source_type === "static_fee_explainer") {
    const raw = await readFile(feeExplainerPath, "utf8");
    return normalizeText(raw.replace(/^---[\s\S]*?\n---/, ""));
  }

  if (source.url) {
    return scrape(source.url);
  }

  const raw = await readFile(feeExplainerPath, "utf8");
  return normalizeText(raw.replace(/^---[\s\S]*?\n---/, ""));
}
