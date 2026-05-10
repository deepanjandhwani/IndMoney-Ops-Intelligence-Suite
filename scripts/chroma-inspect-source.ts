/**
 * List Chroma chunks for one source_id — useful to verify scraped text includes
 * values like expense ratio before debugging retrieval.
 *
 * Usage:
 *   CHROMA_URL=http://127.0.0.1:8001 CHROMA_COLLECTION=smart-sync-kb \\
 *     npx tsx scripts/chroma-inspect-source.ts src_001
 *
 * Optionally load `.env.local` if present:
 *   DOTENV_OVERRIDE_PATH=.env.local npx tsx scripts/chroma-inspect-source.ts src_001
 */
import path from "node:path";
import { existsSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { ChromaClient } from "chromadb";

function loadEnvFiles(): void {
  const root = process.cwd();
  const override = process.env.DOTENV_OVERRIDE_PATH?.trim();
  if (override) {
    const envPath = path.join(root, override);
    if (existsSync(envPath)) loadEnv({ path: envPath });
    return;
  }
  const base = path.join(root, ".env");
  const local = path.join(root, ".env.local");
  if (existsSync(base)) loadEnv({ path: base });
  if (existsSync(local)) loadEnv({ path: local });
}

function hasExpenseSignal(text: string): boolean {
  const lower = text.toLowerCase();
  return /\b\d+(?:\.\d+)?%/.test(text) && (lower.includes("expense ratio") || lower.includes("expense"));
}

async function main() {
  loadEnvFiles();

  const sourceId = process.argv[2] ?? "src_001";
  const urlRaw = process.env.CHROMA_URL ?? "http://127.0.0.1:8001";
  const url = new URL(urlRaw);
  const collectionName = process.env.CHROMA_COLLECTION ?? "smart-sync-kb";

  console.log(`Chroma URL: ${urlRaw}`);
  console.log(`Collection: ${collectionName}`);
  console.log(`source_id: ${sourceId}\n`);

  const client = new ChromaClient({
    host: url.hostname,
    port: Number(url.port || (url.protocol === "https:" ? 443 : 80)),
    ssl: url.protocol === "https:"
  });

  const collection = await client.getCollection({ name: collectionName });

  const got = await collection.get({
    where: { source_id: sourceId },
    limit: 200,
    include: ["documents", "metadatas"]
  });

  const ids = got.ids ?? [];
  const docs = got.documents ?? [];
  const meta = got.metadatas ?? [];

  if (ids.length === 0) {
    console.error(
      "No chunks found. Is Chroma running (e.g. `npm run chroma:local`)? Correct CHROMA_URL / collection?"
    );
    process.exit(1);
    return;
  }

  console.log(`Found ${ids.length} chunk(s).\n`);

  let withEr = 0;
  for (let i = 0; i < ids.length; i++) {
    const text = docs[i] ?? "";
    const m = (meta[i] ?? {}) as Record<string, unknown>;
    const scheme = typeof m.scheme_name === "string" ? m.scheme_name : "";
    const section = typeof m.section_type === "string" ? m.section_type : "";
    const title = typeof m.title === "string" ? m.title : "";
    const hasEr = hasExpenseSignal(text);

    if (hasEr) withEr++;

    console.log("---");
    console.log(`id: ${ids[i]}`);
    console.log(`title: ${title} | scheme_name: ${scheme} | section_type: ${section}`);
    console.log(
      `expense-ratio-like content: ${hasEr ? "yes" : "no"} (heuristic: "expense" + %-style figure)`
    );
    const preview =
      text.length > 560 ? `${text.slice(0, 560)}… (${text.length} chars total)` : text;
    console.log("text preview:\n" + preview + "\n");
  }

  console.log("Summary:", withEr ? `${withEr} chunk(s) look like they carry expense-ratio numbers.` : "No chunks matched expense-ratio heuristic.");
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
