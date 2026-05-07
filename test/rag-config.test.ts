import { describe, expect, it } from "vitest";

import { chunkSource } from "../src/rag/chunk";
import { loadFeeExplainerSource, loadSourceManifest } from "../src/rag/manifest";
import { getApprovedSchemeNames, _resetApprovedSchemeNamesCache } from "../src/rag/fund-resolver";

describe("Phase 3 RAG source config", () => {
  it("loads the approved source manifest without duplicate URLs", async () => {
    const manifest = await loadSourceManifest("config/source_urls.json");
    const urls = manifest.sources.map((source) => source.url);

    expect(manifest.sources.length).toBeGreaterThanOrEqual(15);
    expect(new Set(urls).size).toBe(urls.length);
    expect(manifest.sources[0]).toMatchObject({
      source_id: "src_001",
      source_type: "official_url",
      content_type: "scheme_fact",
      scrape_status: "pending"
    });

    const contentTypes = new Set(manifest.sources.map((source) => source.content_type));
    expect(contentTypes.has("regulatory_education")).toBe(true);
    expect(contentTypes.has("help_page")).toBe(true);
  });

  it("loads the approved fee explainer as fee_static_001", async () => {
    const source = await loadFeeExplainerSource("config/static_fee_explainer.md");

    expect(source).toMatchObject({
      source_id: "fee_static_001",
      source_type: "static_fee_explainer",
      content_type: "fee_explanation",
      title: "Groww — Expense Ratio (approved educational explainer)"
    });
    expect(source.url).toBe("https://groww.in/p/expense-ratio");
  });

  it("getApprovedSchemeNames returns scheme names and caches them", () => {
    _resetApprovedSchemeNamesCache();
    const names = getApprovedSchemeNames();
    expect(names.length).toBeGreaterThan(0);
    expect(names).toContain("HDFC Defence Fund Direct Growth");

    const cached = getApprovedSchemeNames();
    expect(cached).toBe(names);
  });

  it("chunks scheme facts with section metadata", () => {
    const chunks = chunkSource(
      {
        source_id: "src_test",
        source_type: "official_url",
        content_type: "scheme_fact",
        title: "Test Scheme",
        url: "https://example.com",
        last_checked: "2026-05-01",
        scrape_status: "pending",
        scheme_name: "Test Scheme"
      },
      `Exit Load
       Exit load is 1% if units are redeemed within the scheme specified period.

       Expense Ratio
       Expense ratio is published on the official scheme page and can change over time.`
    );

    expect(chunks).toHaveLength(2);
    expect(chunks[0].metadata.section_type).toBe("exit_load");
    expect(chunks[1].metadata.section_type).toBe("expense_ratio");
  });
});
