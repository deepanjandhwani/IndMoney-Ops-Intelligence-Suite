import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { runRagIngestion } from "../src/rag/ingest";
import type { VectorStore } from "../src/rag/chroma";

describe("fee_static_001 ingestion", () => {
  it("reads markdown file body even when frontmatter includes citation url", async () => {
    const scrape = vi.fn().mockImplementation(() => {
      throw new Error("scrape should not run for static_fee_explainer");
    });

    const upsertMock = vi.fn().mockResolvedValue(undefined);

    const vectorStore: VectorStore = {
      upsert: upsertMock,
      query: vi.fn(),
      getSourceContentHash: vi.fn().mockResolvedValue(null),
      deleteBySourceId: vi.fn().mockResolvedValue(0),
      deleteSourcesExcept: vi.fn().mockResolvedValue(0)
    };

    const embedDocuments = vi.fn().mockImplementation((texts: string[]) =>
      texts.map(() => new Array(768).fill(0.01))
    );

    const result = await runRagIngestion(
      {
        sourceManifestPath: join(__dirname, "fixtures/rag-ingest-empty-manifest.json"),
        feeExplainerPath: join(__dirname, "fixtures/fee-static-with-citation-url.md"),
        chromaCollection: "test_kb",
        forceReIngest: true
      },
      {
        vectorStore,
        llm: { embedDocuments },
        scrape
      }
    );

    expect(result.sources_failed).toBe(0);
    expect(scrape).not.toHaveBeenCalled();
    expect(embedDocuments).toHaveBeenCalled();
    const firstUpsertArg = upsertMock.mock.calls[0]?.[0] ?? [];
    const joined = firstUpsertArg.map((c: { text: string }) => c.text).join("\n");
    expect(joined).toContain("STATIC_ONLY_BODY_XYZ9");
  });
});
