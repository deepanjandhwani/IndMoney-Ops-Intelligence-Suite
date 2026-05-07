import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

import { runRagIngestion } from "../rag/ingest";

loadEnv({ path: resolve(process.cwd(), ".env") });
loadEnv({ path: resolve(process.cwd(), ".env.local"), override: true });

async function main() {
  const result = await runRagIngestion({
    sourceManifestPath: process.env.RAG_SOURCE_MANIFEST_PATH ?? "config/source_urls.json",
    feeExplainerPath: process.env.RAG_FEE_EXPLAINER_PATH ?? "config/static_fee_explainer.md",
    chromaCollection: process.env.CHROMA_COLLECTION ?? "smart-sync-kb",
    forceReIngest: process.env.RAG_FORCE_REINGEST === "true"
  });

  console.log(JSON.stringify(result, null, 2));

  if (result.sources_failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      status: "failed",
      error: error instanceof Error ? error.message : "Unknown Smart-Sync ingestion failure"
    })
  );
  process.exitCode = 1;
});
