import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextResponse } from "next/server";

export const runtime = "nodejs";

type FundEntry = {
  scheme_name: string;
  fund_type: string;
  risk_category: string;
};

type SourceRecord = {
  content_type?: string;
  scheme_name?: string;
  fund_type?: string;
  risk_category?: string;
};

export async function GET() {
  try {
    const raw = readFileSync(join(process.cwd(), "config/source_urls.json"), "utf-8");
    const manifest = JSON.parse(raw) as { sources: SourceRecord[] };

    const funds: FundEntry[] = manifest.sources
      .filter((s) => s.content_type === "scheme_fact" && s.scheme_name)
      .map((s) => ({
        scheme_name: s.scheme_name!,
        fund_type: s.fund_type ?? "other",
        risk_category: s.risk_category ?? "Unknown"
      }));

    return NextResponse.json({ funds });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load fund catalog." },
      { status: 500 }
    );
  }
}
