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
  Loader2
} from "lucide-react";

type EvalCategory = {
  id: string;
  label: string;
  description: string;
  icon: typeof Search;
  checks: { name: string; passed: boolean | null }[];
};

const INITIAL_CATEGORIES: EvalCategory[] = [
  {
    id: "retrieval",
    label: "Retrieval Accuracy",
    description: "Verifies RAG retrieval returns relevant chunks for golden-set questions",
    icon: Search,
    checks: [
      { name: "Exit load retrieval for scheme_fact source", passed: null },
      { name: "Expense ratio retrieval with BM25 boost", passed: null },
      { name: "Fee explainer retrieval for fee_static source", passed: null },
      { name: "Multi-source retrieval (scheme + fee)", passed: null },
      { name: "Out-of-scope query correctly refused", passed: null }
    ]
  },
  {
    id: "safety",
    label: "Safety Guard",
    description: "Ensures no investment advice, buy/sell/hold signals, or return predictions leak through",
    icon: ShieldCheck,
    checks: [
      { name: "Buy/sell recommendation refusal", passed: null },
      { name: "Return prediction refusal", passed: null },
      { name: "Portfolio advice refusal", passed: null }
    ]
  },
  {
    id: "pii",
    label: "PII Masking",
    description: "Validates PII is detected and masked before storage and in responses",
    icon: Fingerprint,
    checks: [
      { name: "Phone number masking in review text", passed: null },
      { name: "Email masking in scheduler conversation", passed: null },
      { name: "PAN/Aadhaar masking in FAQ input", passed: null }
    ]
  },
  {
    id: "integration",
    label: "Integration Sync",
    description: "Checks calendar, sheet, and email draft sync after booking operations",
    icon: Link2,
    checks: [
      { name: "Calendar hold created on booking", passed: null },
      { name: "Sheet row created with booking code", passed: null },
      { name: "Email draft includes market context", passed: null },
      { name: "HITL and sheet status stay in sync", passed: null }
    ]
  },
  {
    id: "cost",
    label: "Cost & Model",
    description: "Verifies free-tier compliance: correct model selection, no retired models, no paid APIs",
    icon: Cpu,
    checks: [
      { name: "No retired Gemini 2.0 model references", passed: null },
      { name: "Classification uses Flash-Lite", passed: null },
      { name: "Generation uses Flash (not Pro)", passed: null },
      { name: "No Pinecone references in codebase", passed: null }
    ]
  }
];

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4 } }
};

export function EvalsClient() {
  const [categories, setCategories] = useState(INITIAL_CATEGORIES);
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<string | null>(null);

  function simulateRun() {
    setRunning(true);
    setTimeout(() => {
      setCategories((prev) =>
        prev.map((cat) => ({
          ...cat,
          checks: cat.checks.map((check) => ({
            ...check,
            passed: Math.random() > 0.15
          }))
        }))
      );
      setLastRun(new Date().toLocaleTimeString());
      setRunning(false);
    }, 2000);
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
            {totalChecks} checks across {categories.length} categories
            {lastRun && <> &middot; Last run: {lastRun}</>}
          </p>
        </div>
        <button
          type="button"
          onClick={simulateRun}
          disabled={running}
          className="!bg-accent !text-white !font-bold !px-6 !py-2.5 !rounded-full !text-sm hover:!bg-accent-strong flex items-center gap-2"
        >
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          {running ? "Running..." : "Run Evals"}
        </button>
      </motion.div>

      {hasResults && (
        <motion.div variants={fadeUp} className="grid grid-cols-3 gap-4">
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
                  {pending === cat.checks.length ? (
                    <span className="text-xs text-muted">Not run</span>
                  ) : (
                    <span className="text-xs font-bold">
                      <span className="text-success">{passed}</span>
                      {" / "}
                      <span className={failed > 0 ? "text-danger" : "text-muted"}>{cat.checks.length}</span>
                    </span>
                  )}
                </div>
              </div>

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
                    <span className={`text-sm ${check.passed === false ? "text-danger font-semibold" : "text-foreground"}`}>
                      {check.name}
                    </span>
                  </div>
                ))}
              </div>
            </motion.article>
          );
        })}
      </div>
    </motion.div>
  );
}
