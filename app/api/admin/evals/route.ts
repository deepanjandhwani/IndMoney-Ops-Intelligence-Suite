import { NextResponse } from "next/server";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

import { maskPii } from "@/services/safety/pii";
import {
  getLlmModelConfig,
  assertNoRetiredGeminiModel
} from "@/adapters/llm/models";

const PII_TESTS = [
  {
    id: "PII1",
    label: "PAN in FAQ query",
    input: "My PAN is ABCDE1234F, what is the exit load?",
    piiPattern: /ABCDE1234F/i
  },
  {
    id: "PII2",
    label: "Phone in voice transcript",
    input: "My number is 9876543210, I need help with nominee update",
    piiPattern: /9876543210/
  },
  {
    id: "PII3",
    label: "Email in review text",
    input: "Please contact me at john@gmail.com for this issue",
    piiPattern: /john@gmail\.com/i
  }
];

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".next" || entry === "dist") continue;
    const full = join(dir, entry);
    try {
      const stat = statSync(full);
      if (stat.isDirectory()) collectSourceFiles(full, acc);
      else if ([".ts", ".tsx", ".js", ".jsx"].includes(extname(full))) acc.push(full);
    } catch {
      /* skip */
    }
  }
  return acc;
}

type CheckResult = { id: string; label: string; pass: boolean; detail: string };

function runPiiChecks(): CheckResult[] {
  return PII_TESTS.map((t) => {
    const result = maskPii(t.input);
    const leaked = t.piiPattern.test(result.maskedText);
    return {
      id: t.id,
      label: t.label,
      pass: !leaked && result.findings.length > 0,
      detail: leaked
        ? `PII leaked: "${result.maskedText}"`
        : `Masked ${result.findings.map((f) => `${f.type}(${f.count})`).join(", ")}`
    };
  });
}

function runStaticChecks(): CheckResult[] {
  const projectRoot = join(process.cwd());
  const checks: CheckResult[] = [];

  const tsFiles = collectSourceFiles(projectRoot);
  const allCode = tsFiles
    .map((f) => {
      try {
        return readFileSync(f, "utf8");
      } catch {
        return "";
      }
    })
    .join("\n");

  const gemini20Hits = allCode.match(/gemini[_-]?2\.0/gi) ?? [];
  checks.push({
    id: "STATIC1",
    label: "No retired Gemini 2.0 model references",
    pass: gemini20Hits.length === 0,
    detail: gemini20Hits.length === 0 ? "Clean" : `Found ${gemini20Hits.length} references`
  });

  const pineconeHits = allCode.match(/pinecone/gi) ?? [];
  checks.push({
    id: "STATIC2",
    label: "No Pinecone references in codebase",
    pass: pineconeHits.length <= 1,
    detail:
      pineconeHits.length <= 1
        ? "Clean (eval-only mention OK)"
        : `Found ${pineconeHits.length} references`
  });

  try {
    const config = getLlmModelConfig();
    checks.push({
      id: "STATIC3",
      label: "Classification uses Flash-Lite (cheapest)",
      pass: config.geminiClassificationModel.includes("flash-lite"),
      detail: `Model: ${config.geminiClassificationModel}`
    });
    checks.push({
      id: "STATIC4",
      label: "Generation uses Flash (not Pro by default)",
      pass:
        config.geminiGenerationModel.includes("flash") &&
        !config.geminiGenerationModel.includes("pro"),
      detail: `Model: ${config.geminiGenerationModel}`
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    checks.push({ id: "STATIC3", label: "Classification uses Flash-Lite", pass: false, detail: msg });
    checks.push({ id: "STATIC4", label: "Generation uses Flash", pass: false, detail: msg });
  }

  try {
    assertNoRetiredGeminiModel(getLlmModelConfig());
    checks.push({
      id: "STATIC5",
      label: "No retired Gemini model in active config",
      pass: true,
      detail: "All models current"
    });
  } catch (e) {
    checks.push({
      id: "STATIC5",
      label: "No retired Gemini model in active config",
      pass: false,
      detail: (e as Error).message
    });
  }

  const chromaRefs = allCode.match(/smart[-_]?sync[-_]?kb/gi) ?? [];
  checks.push({
    id: "STATIC6",
    label: "ChromaDB smart-sync-kb is active vector DB",
    pass: chromaRefs.length > 0,
    detail: `${chromaRefs.length} references found`
  });

  const sendEmailHits = allCode.match(/gmail\..*\.send\b|\.send\(\s*\{.*message/gi) ?? [];
  checks.push({
    id: "STATIC7",
    label: "No auto-send email (draft-only)",
    pass: sendEmailHits.length === 0,
    detail: sendEmailHits.length === 0 ? "Draft-only confirmed" : `${sendEmailHits.length} potential sends`
  });

  return checks;
}

function loadLastReport(): Record<string, unknown> | null {
  try {
    const content = readFileSync(join(process.cwd(), "evals/phase3-report.json"), "utf8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export async function GET() {
  const pii = runPiiChecks();
  const staticChecks = runStaticChecks();
  const lastReport = loadLastReport();

  const piiPass = pii.filter((p) => p.pass).length;
  const staticPass = staticChecks.filter((c) => c.pass).length;

  const goldenFromReport = lastReport?.golden as CheckResult[] | undefined;
  const safetyFromReport = lastReport?.safety as CheckResult[] | undefined;
  const reportSummary = lastReport?.summary as Record<string, number> | undefined;

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    last_full_report: lastReport ? (lastReport as Record<string, unknown>).timestamp ?? null : null,
    categories: {
      retrieval: {
        label: "Retrieval Accuracy",
        checks: goldenFromReport?.map((g) => ({
          name: `${g.id}: Golden retrieval`,
          passed: g.pass
        })) ?? [{ name: "Run npm run evals:phase3 to generate", passed: null }]
      },
      safety: {
        label: "Safety Guard",
        checks: safetyFromReport?.map((s) => ({
          name: `${(s as Record<string, unknown>).id}: Adversarial refusal`,
          passed: s.pass
        })) ?? [{ name: "Run npm run evals:phase3 to generate", passed: null }]
      },
      pii: {
        label: "PII Masking",
        checks: pii.map((p) => ({ name: `${p.id}: ${p.label}`, passed: p.pass }))
      },
      integration: {
        label: "Integration Sync",
        checks: [
          { name: "Calendar hold created on booking", passed: null },
          { name: "Sheet row created with booking code", passed: null },
          { name: "Email draft includes market context", passed: null },
          { name: "HITL and sheet status stay in sync", passed: null }
        ]
      },
      cost: {
        label: "Cost & Model",
        checks: staticChecks.map((c) => ({ name: `${c.id}: ${c.label}`, passed: c.pass }))
      }
    },
    summary: {
      golden_pass: reportSummary?.golden_pass ?? 0,
      golden_total: reportSummary?.golden_total ?? 5,
      safety_pass: reportSummary?.safety_pass ?? 0,
      safety_total: reportSummary?.safety_total ?? 4,
      pii_pass: piiPass,
      pii_total: pii.length,
      static_pass: staticPass,
      static_total: staticChecks.length
    }
  });
}
