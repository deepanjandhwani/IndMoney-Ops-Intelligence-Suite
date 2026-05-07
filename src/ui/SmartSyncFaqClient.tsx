"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

type Citation = {
  source_url: string | null;
  source_id: string;
  source_title: string;
  last_checked: string;
  content_type: string;
};

type FaqResponse = {
  answer: string;
  citations: Citation[];
  status: "answered" | "refused" | "no_results" | "fund_mismatch";
  health_error?: string;
  pii_masked?: boolean;
  resolved_fund?: string | null;
  suggested_fund?: string | null;
  suggested_funds?: string[];
};

type FundCatalogEntry = { scheme_name: string };

const EXAMPLE_QUESTIONS: string[] = [
  "What is the expense ratio of HDFC Defence Fund Direct Growth?",
  "What is exit load and why is it charged?",
  "How do I download a capital-gains statement?"
];

export function SmartSyncFaqClient({ role }: { role: "Customer" | "Admin" }) {
  const [question, setQuestion] = useState("");
  const [response, setResponse] = useState<FaqResponse | null>(null);
  const [retryQuestion, setRetryQuestion] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fundCatalog, setFundCatalog] = useState<FundCatalogEntry[]>([]);
  const [selectedFunds, setSelectedFunds] = useState<Set<string>>(new Set());
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    fetch("/api/smart-sync-faq/funds")
      .then((r) => r.json())
      .then((d: { funds?: FundCatalogEntry[] }) => {
        if (Array.isArray(d.funds)) {
          setFundCatalog(d.funds);
        }
      })
      .catch(() => {});
  }, []);

  async function askQuestion(questionText: string) {
    const trimmedQuestion = questionText.trim();
    if (!trimmedQuestion) return;

    setIsLoading(true);
    setError(null);

    try {
      const result = await fetch("/api/smart-sync-faq", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: trimmedQuestion,
          selected_funds: Array.from(selectedFunds)
        })
      });

      const data = (await result.json()) as FaqResponse | { error: string };
      if (!result.ok || "error" in data) {
        throw new Error("error" in data ? data.error : "FAQ request failed.");
      }

      setResponse(data);
      setRetryQuestion(
        data.status === "fund_mismatch" || data.answer.startsWith("Please select at least one fund")
          ? trimmedQuestion
          : null
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "FAQ request failed.");
    } finally {
      setIsLoading(false);
    }
  }

  async function submitQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await askQuestion(question);
  }

  function fillExample(example: string) {
    setQuestion(example);
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  }

  const allSelected = selectedFunds.size === fundCatalog.length;

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-10">
      <header>
        <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">{role}</p>
        <h1 className="mt-2 text-3xl font-bold text-slate-950">Smart-Sync FAQ</h1>
        <p className="mt-3 text-slate-600">
          Welcome! Ask factual questions about the approved mutual-fund sources. Answers are
          limited to indexed ChromaDB chunks and include citation metadata.
        </p>
        <span
          className="mt-3 inline-block rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-800"
          aria-label="Disclaimer"
        >
          Facts-only. No investment advice.
        </span>
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Try an example</p>
          <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Example questions">
            {EXAMPLE_QUESTIONS.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => fillExample(example)}
                className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:border-slate-500"
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      </header>

      {fundCatalog.length > 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-slate-700">
              Funds ({selectedFunds.size}/{fundCatalog.length} selected)
            </p>
            <button
              type="button"
              onClick={() => setSelectedFunds(allSelected ? new Set() : new Set(fundCatalog.map((f) => f.scheme_name)))}
              className="text-xs text-indigo-600 hover:text-indigo-800"
            >
              {allSelected ? "Deselect all" : "Select all"}
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {fundCatalog.map((f) => (
              <button
                key={f.scheme_name}
                type="button"
                onClick={() => {
                  setSelectedFunds((prev) => {
                    const next = new Set(prev);
                    if (next.has(f.scheme_name)) next.delete(f.scheme_name);
                    else next.add(f.scheme_name);
                    return next;
                  });
                }}
                className={`rounded-full border px-3 py-1 text-xs ${
                  selectedFunds.has(f.scheme_name)
                    ? "border-indigo-400 bg-indigo-50 text-indigo-700"
                    : "border-slate-300 bg-white text-slate-500"
                }`}
              >
                {f.scheme_name}
              </button>
            ))}
          </div>
          {selectedFunds.size === 0 ? (
            <p className="faq-filter-hint faq-filter-hint--warning">Please select at least one fund to ask questions.</p>
          ) : null}
        </div>
      ) : null}

      <form onSubmit={submitQuestion} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <label htmlFor="faq-question" className="block text-sm font-medium text-slate-700">
          Question
        </label>
        <textarea
          id="faq-question"
          ref={textareaRef}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          rows={4}
          className="mt-2 w-full rounded-xl border border-slate-300 p-3 text-slate-900 outline-none focus:border-slate-700"
          placeholder="What is the expense ratio and where is it listed?"
        />
        <button
          type="submit"
          disabled={isLoading || question.trim().length === 0}
          className="mt-4 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {isLoading ? "Checking approved sources..." : "Ask FAQ"}
        </button>
      </form>

      {error ? <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p> : null}

      {response ? (
        <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
          <div className="flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-wide">
            <span className="rounded-full bg-slate-200 px-3 py-1 text-slate-700">{response.status}</span>
            {response.pii_masked ? (
              <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-800">PII masked</span>
            ) : null}
          </div>
          <p className="mt-4 whitespace-pre-wrap text-slate-900">{response.answer}</p>

          {(() => {
            const suggestedList =
              response.suggested_funds && response.suggested_funds.length > 0
                ? response.suggested_funds
                : response.suggested_fund
                  ? [response.suggested_fund]
                  : [];
            const showQuickAddChips = response.status === "fund_mismatch" && suggestedList.length > 0;
            if (!showQuickAddChips && !retryQuestion) {
              return null;
            }
            return (
              <div
                className="mt-4 grid gap-3 rounded-2xl border border-slate-200 bg-gradient-to-b from-white to-slate-50 p-4 shadow-sm"
                role="region"
                aria-label="Fund selection and retry"
              >
                {retryQuestion ? (
                  <p className="faq-fund-selection-hint text-slate-600">
                    Select the funds that apply to your question and hit <strong className="text-slate-800">Retry</strong>.
                  </p>
                ) : null}
                {showQuickAddChips ? (
                  <div className="flex flex-wrap gap-2">
                    {suggestedList.map((fund) => (
                      <button
                        key={fund}
                        type="button"
                        onClick={() => setSelectedFunds((prev) => new Set([...prev, fund]))}
                        className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-800 transition-colors hover:border-indigo-400 hover:bg-indigo-100"
                      >
                        Add {fund} to selection
                      </button>
                    ))}
                  </div>
                ) : null}
                {retryQuestion ? (
                  <button
                    type="button"
                    onClick={() => void askQuestion(retryQuestion)}
                    disabled={isLoading}
                    className="faq-retry-button"
                  >
                    <RefreshCw size={17} aria-hidden strokeWidth={2} />
                    Retry question
                  </button>
                ) : null}
              </div>
            );
          })()}

          {response.citations.length > 0 ? (
            <div className="mt-5">
              <h2 className="text-sm font-semibold text-slate-700">Citations</h2>
              <ul className="mt-2 space-y-2 text-sm text-slate-600">
                {response.citations.map((citation) => (
                  <li key={`${citation.source_id}-${citation.last_checked}`}>
                    <span className="font-medium text-slate-800">{citation.source_title}</span>{" "}
                    <span>({citation.source_id}, last checked {citation.last_checked})</span>
                    {citation.source_url ? (
                      <a
                        className="ml-2 underline"
                        href={citation.source_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Source
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {response.health_error ? (
            <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
              Admin health: {response.health_error}
            </p>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
