"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  BarChart3,
  Star,
  Quote,
  Lightbulb,
  FileText,
  AlertCircle,
  TrendingUp
} from "lucide-react";
import { WeeklySummaryBody } from "@/ui/WeeklySummaryBody";

type Theme = { theme: string; rank: number };
type ActionIdea = { idea: string; based_on_theme: string; evidence: string };

type PulseData = {
  product: string;
  period: string;
  total_reviews_analyzed: number;
  average_rating: number;
  top_themes: Theme[];
  representative_quotes: string[];
  weekly_summary: string;
  action_ideas: ActionIdea[];
  top_customer_themes: string[];
  source: string;
  created_at: string;
};

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4 } }
};

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`w-4 h-4 ${i <= Math.round(rating) ? "text-warning fill-warning" : "text-border"}`}
        />
      ))}
      <span className="ml-1.5 text-sm font-bold text-foreground">{rating.toFixed(1)}</span>
    </div>
  );
}

export function ReviewPulseClient() {
  const [pulse, setPulse] = useState<PulseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/review-pulse")
      .then((r) => r.json())
      .then((d) => setPulse(d.pulse))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-3 text-muted py-20">
        <div className="w-5 h-5 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
        Loading Review Pulse...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-3 text-danger bg-danger/5 border border-danger/20 rounded-2xl p-4">
        <AlertCircle className="w-5 h-5 shrink-0" />
        {error}
      </div>
    );
  }

  if (!pulse) {
    return (
      <div className="bg-card border border-border rounded-3xl p-10 text-center">
        <BarChart3 className="w-10 h-10 text-muted mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-foreground">No pulse data yet</h2>
        <p className="mt-2 text-muted text-sm">
          Run the review ingestion and clustering pipeline to generate the first Review Pulse.
        </p>
      </div>
    );
  }

  const maxShare = Math.max(
    ...pulse.top_themes.map((_, i) => 100 - i * 12),
    40
  );

  return (
    <motion.div
      className="space-y-6"
      initial="hidden"
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06 } } }}
    >
      <motion.div variants={fadeUp}>
        <h1
          className="text-[clamp(1.8rem,4vw,2.8rem)] font-[520] tracking-[-0.03em] leading-tight"
          style={{ fontFamily: "Georgia, 'Times New Roman', serif", color: "var(--ink-soft)" }}
        >
          Review Pulse
        </h1>
        <p className="mt-1 text-muted text-sm">{pulse.period}</p>
      </motion.div>

      <motion.div variants={fadeUp} className="grid sm:grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-2xl p-5 flex flex-col gap-2">
          <span className="text-xs font-bold tracking-wider uppercase text-muted">Reviews</span>
          <span className="text-3xl font-bold text-foreground">{pulse.total_reviews_analyzed.toLocaleString()}</span>
          <span className="text-xs text-muted">{pulse.source}</span>
        </div>
        <div className="bg-card border border-border rounded-2xl p-5 flex flex-col gap-2">
          <span className="text-xs font-bold tracking-wider uppercase text-muted">Avg Rating</span>
          <StarRating rating={pulse.average_rating} />
          <span className="text-xs text-muted">across all analyzed reviews</span>
        </div>
        <div className="bg-card border border-border rounded-2xl p-5 flex flex-col gap-2">
          <span className="text-xs font-bold tracking-wider uppercase text-muted">Top Themes</span>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {pulse.top_customer_themes.map((t) => (
              <span key={t} className="bg-accent/10 text-accent-strong text-xs font-semibold px-2.5 py-1 rounded-full">
                {t}
              </span>
            ))}
          </div>
        </div>
      </motion.div>

      <motion.div variants={fadeUp}>
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="w-4 h-4 text-accent" />
          <h2 className="text-lg font-bold text-foreground">Top 5 Themes</h2>
        </div>
        <div className="space-y-2.5">
          {pulse.top_themes.map((theme, index) => {
            const barWidth = ((100 - index * 12) / maxShare) * 100;
            return (
              <motion.div
                key={theme.theme}
                variants={fadeUp}
                className="bg-card border border-border rounded-xl p-4 flex items-center gap-4"
              >
                <span className="w-8 h-8 rounded-lg bg-accent/10 text-accent font-extrabold text-sm flex items-center justify-center shrink-0">
                  {theme.rank}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-foreground truncate">{theme.theme}</p>
                  <div className="mt-1.5 h-2 rounded-full bg-border/40 overflow-hidden">
                    <motion.div
                      className="h-full rounded-full bg-accent/70"
                      initial={{ width: 0 }}
                      animate={{ width: `${barWidth}%` }}
                      transition={{ duration: 0.6, delay: index * 0.1 }}
                    />
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </motion.div>

      <motion.div variants={fadeUp}>
        <div className="flex items-center gap-2 mb-3">
          <Quote className="w-4 h-4 text-accent" />
          <h2 className="text-lg font-bold text-foreground">Representative Quotes</h2>
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          {pulse.representative_quotes.map((quote, i) => (
            <motion.blockquote
              key={i}
              variants={fadeUp}
              className="bg-card border border-border rounded-2xl p-5 relative"
            >
              <Quote className="w-6 h-6 text-accent/20 absolute top-4 right-4" />
              <p className="text-sm leading-relaxed text-foreground italic pr-6">
                &ldquo;{quote}&rdquo;
              </p>
            </motion.blockquote>
          ))}
        </div>
      </motion.div>

      <motion.div variants={fadeUp}>
        <div className="flex items-center gap-2 mb-3">
          <Lightbulb className="w-4 h-4 text-accent" />
          <h2 className="text-lg font-bold text-foreground">Action Ideas</h2>
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          {pulse.action_ideas.map((idea, i) => (
            <motion.article
              key={i}
              variants={fadeUp}
              className="bg-card border border-border rounded-2xl p-5 flex flex-col gap-3"
            >
              <span className="bg-success/10 text-success text-xs font-bold px-2.5 py-1 rounded-full w-fit">
                {idea.based_on_theme}
              </span>
              <p className="font-semibold text-sm text-foreground">{idea.idea}</p>
              <p className="text-xs text-muted leading-relaxed">{idea.evidence}</p>
            </motion.article>
          ))}
        </div>
      </motion.div>

      <motion.div variants={fadeUp}>
        <div className="flex items-center gap-2 mb-3">
          <FileText className="w-4 h-4 text-accent" />
          <h2 className="text-lg font-bold text-foreground">Weekly Summary</h2>
        </div>
        <div
          className={`rounded-2xl border p-6 md:p-7 bg-gradient-to-br from-card via-card to-accent/[0.04] ${
            pulse.average_rating < 3
              ? "border-warning/40 shadow-[inset_0_0_0_1px_rgba(201,127,26,0.12)]"
              : "border-border"
          }`}
        >
          {pulse.average_rating < 3 ? (
            <p className="mb-4 flex items-center gap-2 rounded-xl bg-warning/10 px-3 py-2 text-xs font-bold uppercase tracking-wide text-warning">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Average rating {pulse.average_rating.toFixed(1)} — align narrative with theme cards above
            </p>
          ) : null}
          <WeeklySummaryBody text={pulse.weekly_summary} />
        </div>
      </motion.div>
    </motion.div>
  );
}
