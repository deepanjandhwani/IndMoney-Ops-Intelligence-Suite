"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  BarChart3,
  Star,
  ShieldCheck,
  TrendingUp,
  ArrowRight,
  AlertCircle,
  Database,
  Activity,
  CheckCircle2,
  XCircle
} from "lucide-react";
import { WeeklySummaryBody } from "@/ui/WeeklySummaryBody";

type IngestionRun = {
  id: string;
  source: string;
  status: string;
  total_fetched: number;
  new_stored: number;
  duplicates_skipped: number;
  errors: number;
  created_at: string;
};

type DashboardSummary = {
  pulse: {
    period: string;
    total_reviews_analyzed: number;
    average_rating: number;
    top_themes: { theme: string; rank: number }[];
    weekly_summary: string;
    top_customer_themes: string[];
    created_at: string;
  } | null;
  recentHitl: {
    id: string;
    booking_code: string;
    action_type: string;
    status: string;
    created_at: string;
  }[];
  totalReviews: number;
  pendingHitlCount: number;
  ingestionHealth: {
    recentRuns: IngestionRun[];
    chromaDb: {
      status: string;
      collection: string | null;
      error: string | null;
    };
  };
};

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4 } }
};

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  accentColor
}: {
  icon: typeof BarChart3;
  label: string;
  value: string;
  sub: string;
  accentColor: string;
}) {
  return (
    <motion.div
      variants={fadeUp}
      className="bg-card border border-border rounded-2xl p-5 flex flex-col gap-2"
    >
      <div className="flex items-center gap-2">
        <div
          className="w-8 h-8 rounded-xl flex items-center justify-center"
          style={{ background: `${accentColor}14`, color: accentColor }}
        >
          <Icon className="w-4 h-4" strokeWidth={2.2} />
        </div>
        <span className="text-xs font-bold tracking-wider uppercase text-muted">{label}</span>
      </div>
      <span className="text-2xl font-bold text-foreground">{value}</span>
      <span className="text-xs text-muted">{sub}</span>
    </motion.div>
  );
}

const statusColors: Record<string, string> = {
  pending: "bg-warning/10 text-warning",
  approved: "bg-success/10 text-success",
  rejected: "bg-danger/10 text-danger",
  executed: "bg-info/10 text-info",
  failed: "bg-danger/10 text-danger"
};

export function AdminDashboardClient() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/dashboard-summary")
      .then((r) => r.json())
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-3 text-muted py-20">
        <div className="w-5 h-5 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
        Loading dashboard...
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
          Admin Dashboard
        </h1>
        <p className="mt-1 text-muted text-sm">Overview of review intelligence and operations</p>
      </motion.div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={BarChart3}
          label="Total Reviews"
          value={(data?.totalReviews ?? 0).toLocaleString()}
          sub="Across all ingestion runs"
          accentColor="#b65f2a"
        />
        <StatCard
          icon={Star}
          label="Avg Rating"
          value={data?.pulse?.average_rating?.toFixed(1) ?? "--"}
          sub={data?.pulse?.period ?? "No pulse yet"}
          accentColor="#c97f1a"
        />
        <StatCard
          icon={ShieldCheck}
          label="Pending HITL"
          value={String(data?.pendingHitlCount ?? 0)}
          sub="Awaiting admin decision"
          accentColor="#c93b3b"
        />
        <StatCard
          icon={TrendingUp}
          label="Active Themes"
          value={String(data?.pulse?.top_themes?.length ?? 0)}
          sub="In latest pulse"
          accentColor="#2d8a4e"
        />
      </div>

      {data?.pulse && (
        <motion.div
          variants={fadeUp}
          className="bg-card border border-border rounded-2xl p-6 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-foreground">Latest Pulse Summary</h2>
            <Link
              href="/admin/review-pulse"
              className="flex items-center gap-1 text-xs font-bold text-accent hover:text-accent-strong transition-colors no-underline"
            >
              View full pulse <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <WeeklySummaryBody text={data.pulse.weekly_summary} className="max-h-[min(28rem,55vh)] overflow-y-auto pr-1" />
          <div className="flex flex-wrap gap-2">
            {data.pulse.top_customer_themes.map((t) => (
              <span
                key={t}
                className="bg-accent/10 text-accent-strong text-xs font-semibold px-2.5 py-1 rounded-full"
              >
                {t}
              </span>
            ))}
          </div>
        </motion.div>
      )}

      <motion.div variants={fadeUp} className="bg-card border border-border rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-foreground">Recent HITL Activity</h2>
          <Link
            href="/admin/hitl"
            className="flex items-center gap-1 text-xs font-bold text-accent hover:text-accent-strong transition-colors no-underline"
          >
            View all <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        {(!data?.recentHitl || data.recentHitl.length === 0) ? (
          <p className="text-sm text-muted">No HITL actions recorded yet.</p>
        ) : (
          <div className="space-y-2.5">
            {data.recentHitl.map((action) => (
              <div
                key={action.id}
                className="flex items-center justify-between py-2 border-b border-border/50 last:border-0"
              >
                <div className="flex items-center gap-3">
                  <code className="text-sm font-bold text-foreground">{action.booking_code}</code>
                  <span className="text-xs text-muted">{action.action_type}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${statusColors[action.status] ?? "bg-muted/10 text-muted"}`}>
                    {action.status}
                  </span>
                  <span className="text-xs text-muted">
                    {new Date(action.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </motion.div>

      <motion.div variants={fadeUp} className="bg-card border border-border rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-accent" />
            <h2 className="font-bold text-foreground">Ingestion Health</h2>
          </div>
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-muted" />
            <span className="text-xs text-muted">
              ChromaDB:{" "}
              <span
                className={
                  data?.ingestionHealth?.chromaDb?.status === "healthy"
                    ? "text-success font-bold"
                    : data?.ingestionHealth?.chromaDb?.status === "unavailable"
                      ? "text-danger font-bold"
                      : "text-warning font-bold"
                }
              >
                {data?.ingestionHealth?.chromaDb?.status ?? "unknown"}
              </span>
              {data?.ingestionHealth?.chromaDb?.collection && (
                <> &middot; {data.ingestionHealth.chromaDb.collection}</>
              )}
            </span>
          </div>
        </div>

        {data?.ingestionHealth?.chromaDb?.error && (
          <div className="flex items-center gap-2 mb-3 bg-danger/5 border border-danger/20 rounded-xl px-3 py-2">
            <XCircle className="w-4 h-4 text-danger shrink-0" />
            <span className="text-xs text-danger">{data.ingestionHealth.chromaDb.error}</span>
          </div>
        )}

        {(!data?.ingestionHealth?.recentRuns || data.ingestionHealth.recentRuns.length === 0) ? (
          <p className="text-sm text-muted">No ingestion runs recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {data.ingestionHealth.recentRuns.map((run) => (
              <div
                key={run.id}
                className="flex items-center justify-between py-2 border-b border-border/50 last:border-0"
              >
                <div className="flex items-center gap-3">
                  {run.status === "success" || run.status === "partial_success" ? (
                    <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 text-danger shrink-0" />
                  )}
                  <div>
                    <span className="text-sm font-semibold text-foreground">{run.source}</span>
                    <span className="text-xs text-muted ml-2">
                      {run.new_stored} new &middot; {run.duplicates_skipped} dupes &middot; {run.errors} errors
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                    run.status === "success" ? "bg-success/10 text-success" :
                    run.status === "partial_success" ? "bg-warning/10 text-warning" :
                    "bg-danger/10 text-danger"
                  }`}>
                    {run.status}
                  </span>
                  <span className="text-xs text-muted">
                    {new Date(run.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </motion.div>

      <motion.div variants={fadeUp} className="grid sm:grid-cols-3 gap-4">
        {[
          { href: "/admin/review-pulse", label: "Review Pulse", desc: "Theme cards and action ideas", icon: BarChart3 },
          { href: "/admin/review-trends", label: "Review Trends", desc: "WoW charts and analysis", icon: TrendingUp },
          { href: "/admin/hitl", label: "HITL Center", desc: "Approve and manage bookings", icon: ShieldCheck }
        ].map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="group bg-card border border-border rounded-2xl p-5 hover:border-accent/30 hover:shadow-lg hover:shadow-black/[0.04] transition-all no-underline"
          >
            <card.icon className="w-5 h-5 text-accent mb-3" />
            <h3 className="font-bold text-sm text-foreground group-hover:text-accent transition-colors">
              {card.label}
            </h3>
            <p className="text-xs text-muted mt-1">{card.desc}</p>
          </Link>
        ))}
      </motion.div>
    </motion.div>
  );
}
