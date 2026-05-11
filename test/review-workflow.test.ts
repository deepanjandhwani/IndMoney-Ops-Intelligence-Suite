import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("review ingestion workflow", () => {
  it("runs ingestion before clustering on schedule, manual dispatch, and repository_dispatch", () => {
    const workflow = readFileSync(
      join(process.cwd(), ".github/workflows/review_ingestion.yml"),
      "utf8"
    );

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("repository_dispatch:");
    expect(workflow).toContain("review-ingestion-weekly");
    expect(workflow).toContain("cron:");
    expect(workflow).toContain("npm run phase2:ingest");
    expect(workflow).toContain("scripts/requirements-clustering.txt");
    expect(workflow).toContain("npm run phase2:cluster");
    expect(workflow).toContain("upload-artifact");
    expect(workflow).toContain("artifacts/review-pulse-latest.json");
    expect(workflow.indexOf("npm run phase2:ingest")).toBeLessThan(
      workflow.indexOf("npm run phase2:cluster")
    );
  });
});
