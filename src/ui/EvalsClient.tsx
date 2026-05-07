"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Search,
  ShieldCheck,
  Fingerprint,
  Link2,
  Cpu,
  CheckCircle2,
  XCircle,
  Play,
  Loader2,
  AlertCircle
} from "lucide-react";

type EvalCheck = { name: string; passed: boolean | null };

type EvalCategory = {
  id: string;
  label: string;
  description: string;
  icon: typeof Search;
  checks: EvalCheck[];
};

const CATEGORY_META: Record<string, { description: string; icon: typeof Search }> = {
  retrieval: {
    description: "Verifies RAG retrieval returns relevant chunks for golden-set questions",
    icon: Search
  },
  safety: {
    description: "Ensures no investment advice, buy/sell/hold signals, or return predictions leak through",
    icon: ShieldCheck
  },
  pii: {
    description: "Validates PII is detected and masked before storage and in responses",
    icon: Fingerprint
  },
  integration: {
    description: "Checks calendar, sheet, and email draft sync after booking operations",
    icon: Link2
  },
  cost: {
    description: "Verifies free-tier compliance: correct model selection, no retired models, no paid APIs",
    icon: Cpu
  }
};

const INITIAL_CATEGORIES: EvalCategory[] = Object.entries(CATEGORY_META).map(
  ([id, meta]) => ({
    id,
    label: meta.description.slice(0, 20),
    description: meta.description,
    icon: meta.icon,
    checks: []
  })
);

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4 } }
};

export function EvalsClient() {
  const [categories, setCategories] = useState<EvalCategory[]>(INITIAL_CATEGORIES);
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastFullReport, setLastFullReport] = useState<string | null>(null);

  async function runEvals() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/evals");
      if (!res.ok) throw new Error(`API returned ${res.status}`);
      const data = await res.json();

      const cats = data.categories as Record<string, { label: string; checks: EvalCheck[] }>;
      const mapped: EvalCategory[] = Object.entries(cats).map(([id, cat]) => ({
        id,
        label: cat.label,
        description: CATEGORY_META[id]?.description ?? cat.label,
        icon: CATEGORY_META[id]?.icon ?? Search,
        checks: cat.checks
      }));

      setCategories(mapped);
      setLastRun(new Date().toLocaleTimeString());
      setLastFullReport(data.last_full_report ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  const totalChecks = categories.reduce((n, c) => n + c.checks.length, 0);
  const passedChecks = categories.reduce(
    (n, c) => n + c.checks.filter((ch) => ch.passed === true).length,
    0
  );
  const failedChecks = categories.reduce(
    (n, c) => n + c.checks.filter((ch) => ch.passed === false).length,
    0
  );
  const pendingChecks = categories.reduce(
    (n, c) => n + c.checks.filter((ch) => ch.passed === null).length,
    0
  );
  const hasResults = categories.some((c) => c.checks.some((ch) => ch.passed !== null));

  return (
    <motion.div
      className="space-y-6"
      initial="hidden"
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06 } } }}
    >
      <motion.div variants={fadeUp} className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1
            className="text-[clamp(1.8rem,4vw,2.8rem)] font-[520] tracking-[-0.03em] leading-tight"
            style={{ fontFamily: "Georgia, 'Times New Roman', serif", color: "var(--ink-soft)" }}
          >
            Evaluation Suite
          </h1>
          <p className="mt-1 text-muted text-sm">
            {totalChecks > 0
              ? `${totalChecks} checks across ${categories.length} categories`
              : `${categories.length} categories`}
            {lastRun && <> &middot; Last run: {lastRun}</>}
          </p>
          {lastFullReport && (
            <p className="text-xs text-muted mt-0.5">
              Last full report (with golden/safety): {new Date(lastFullReport).toLocaleString()}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={runEvals}
          disabled={running}
          className="!bg-accent !text-white !font-bold !px-6 !py-2.5 !rounded-full !text-sm hover:!bg-accent-strong flex items-center gap-2"
        >
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          {running ? "Running..." : "Run Evals"}
        </button>
      </motion.div>

      {error && (
        <motion.div
          variants={fadeUp}
          className="flex items-center gap-3 text-danger bg-danger/5 border border-danger/20 rounded-2xl p-4"
        >
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span className="text-sm">{error}</span>
        </motion.div>
      )}

      {hasResults && (
        <motion.div variants={fadeUp} className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-card border border-border rounded-2xl p-4 text-center">
            <span className="text-2xl font-bold text-foreground">{totalChecks}</span>
            <p className="text-xs text-muted mt-1">Total Checks</p>
          </div>
          <div className="bg-success/5 border border-success/20 rounded-2xl p-4 text-center">
            <span className="text-2xl font-bold text-success">{passedChecks}</span>
            <p className="text-xs text-muted mt-1">Passed</p>
          </div>
          <div className="bg-danger/5 border border-danger/20 rounded-2xl p-4 text-center">
            <span className="text-2xl font-bold text-danger">{failedChecks}</span>
            <p className="text-xs text-muted mt-1">Failed</p>
          </div>
          <div className="bg-card border border-border rounded-2xl p-4 text-center">
            <span className="text-2xl font-bold text-muted">{pendingChecks}</span>
            <p className="text-xs text-muted mt-1">Pending</p>
          </div>
        </motion.div>
      )}

      <div className="space-y-4">
        {categories.map((cat) => {
          const passed = cat.checks.filter((c) => c.passed === true).length;
          const failed = cat.checks.filter((c) => c.passed === false).length;
          const pending = cat.checks.filter((c) => c.passed === null).length;

          return (
            <motion.article
              key={cat.id}
              variants={fadeUp}
              className="bg-card border border-border rounded-2xl p-5 space-y-4"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-accent/10 text-accent flex items-center justify-center">
                  <cat.icon className="w-4.5 h-4.5" strokeWidth={2} />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-sm text-foreground">{cat.label}</h3>
                  <p className="text-xs text-muted">{cat.description}</p>
                </div>
                <div className="text-right shrink-0">
                  {cat.checks.length === 0 ? (
                    <span className="text-xs text-muted">Click Run</span>
                  ) : pending === cat.checks.length ? (
                    <span className="text-xs text-muted">Not run</span>
                  ) : (
                    <span className="text-xs font-bold">
                      <span className="text-success">{passed}</span>
                      {" / "}
                      <span className={failed > 0 ? "text-danger" : "text-muted"}>
                        {cat.checks.length}
                      </span>
                    </span>
                  )}
                </div>
              </div>

              {cat.checks.length > 0 && (
                <div className="space-y-1.5">
                  {cat.checks.map((check) => (
                    <div key={check.name} className="flex items-center gap-2.5 py-1">
                      {check.passed === null ? (
                        <div className="w-4 h-4 rounded-full border-2 border-border shrink-0" />
                      ) : check.passed ? (
                        <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                      ) : (
                        <XCircle className="w-4 h-4 text-danger shrink-0" />
                      )}
                      <span
                        className={`text-sm ${check.passed === false ? "text-danger font-semibold" : "text-foreground"}`}
                      >
                        {check.name}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </motion.article>
          );
        })}
      </div>

      {!hasResults && !running && (
        <motion.div variants={fadeUp} className="text-center py-12 text-muted text-sm">
          Click <strong>Run Evals</strong> to execute PII masking, cost/model static checks, and load
          golden retrieval + safety results.
          <br />
          <span className="text-xs">
            For full golden/safety evals, run{" "}
            <code className="bg-muted/10 px-1.5 py-0.5 rounded text-xs">npm run evals:phase3</code>{" "}
            first.
          </span>
        </motion.div>
      )}
    </motion.div>
  );
}
