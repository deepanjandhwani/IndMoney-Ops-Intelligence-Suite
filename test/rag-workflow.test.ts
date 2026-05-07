import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("Smart-Sync RAG refresh workflow", () => {
  it("refreshes the RAG knowledge base daily at 10 AM IST and on manual dispatch", () => {
    const workflow = readFileSync(
      join(process.cwd(), ".github/workflows/rag_refresh.yml"),
      "utf8"
    );

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain('cron: "30 4 * * *"');
    expect(workflow).toContain("10:00 AM IST daily");
    expect(workflow).toContain("GH_CHROMA_URL");
    expect(workflow).toContain("GH_GEMINI_API_KEY");
    expect(workflow).toContain("npx playwright install --with-deps chromium");
    expect(workflow).toContain("npm run phase3:ingest");
    expect(workflow).toContain("artifacts/rag-refresh-latest.log");
    expect(workflow).toContain("upload-artifact");
    expect(workflow).not.toContain("npm run phase2:ingest");
    expect(workflow).not.toContain("npm run phase2:cluster");
  });
});
