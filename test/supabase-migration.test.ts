import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationDir = join(process.cwd(), "supabase/migrations");
const migrationSql = readdirSync(migrationDir)
  .filter((fileName) => fileName.endsWith(".sql"))
  .sort()
  .map((fileName) => readFileSync(join(migrationDir, fileName), "utf8"))
  .join("\n")
  .toLowerCase();

const REQUIRED_TABLES = [
  "ingestion_runs",
  "reviews",
  "review_pulse",
  "theme_snapshots",
  "review_embeddings",
  "bookings",
  "hitl_actions",
  "secure_details_submissions",
  "assistant_sessions",
  "assistant_session_events"
];

describe("Phase 1 Supabase migration", () => {
  it("declares required public tables", () => {
    for (const table of REQUIRED_TABLES) {
      expect(migrationSql).toContain(`create table public.${table}`);
    }
  });

  it("enables RLS on all Phase 1 public tables", () => {
    for (const table of REQUIRED_TABLES) {
      expect(migrationSql).toContain(`alter table public.${table} enable row level security`);
    }
  });

  it("adds explicit deny policies for exposed public tables", () => {
    expect(migrationSql.match(/create policy "deny anon authenticated access"/g)).toHaveLength(
      REQUIRED_TABLES.length
    );
  });

  it("stores secure-details tokens as hashes and payloads as ciphertext", () => {
    expect(migrationSql).toContain("secure_details_token_hash");
    expect(migrationSql).toContain("details_ciphertext");
    expect(migrationSql).not.toContain("secure_details_token text");
  });
});
