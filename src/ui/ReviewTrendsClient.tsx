"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Zap,
  AlertCircle,
  BarChart3
} from "lucide-react";

type PulseRow = {
  id: string;
  period: string;
  total_reviews_analyzed: number;
  average_rating: number;
  top_themes: { theme: string; rank: number }[];
  created_at: string;
};

type SnapshotRow = {
  pulse_id: string;
  theme_name: string;
  theme_type: string;
  review_count: number;
  theme_share_percent: number;
  trend_status: string;
  wow_change_percent: number | null;
  week_start: string;
  week_end: string;
};

const THEME_COLORS = ["#b65f2a", "#2d8a4e", "#2b6cb0", "#9333ea", "#c97f1a", "#c93b3b"];

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4 } }
};

function TrendBadge({ status }: { status: string }) {
  const configs: Record<string, { icon: typeof TrendingUp; className: string; label: string }> = {
    worsening: { icon: TrendingDown, className: "bg-danger/10 text-danger", label: "Worsening" },
    improving: { icon: TrendingUp, className: "bg-success/10 text-success", label: "Improving" },
    stable: { icon: Minus, className: "bg-muted/10 text-muted", label: "Stable" },
    emerging: { icon: Zap, className: "bg-info/10 text-info", label: "Emerging" }
  };
  const cfg = configs[status] ?? configs.stable;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full ${cfg.className}`}>
      <cfg.icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

export function ReviewTrendsClient() {
  const [pulses, setPulses] = useState<PulseRow[]>([]);
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/review-trends")
      .then((r) => r.json())
      .then((d) => {
        setPulses(d.pulses ?? []);
        setSnapshots(d.snapshots ?? []);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-3 text-muted py-20">
        <div className="w-5 h-5 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
        Loading trend data...
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

  if (pulses.length === 0) {
    return (
      <div className="bg-card border border-border rounded-3xl p-10 text-center">
        <BarChart3 className="w-10 h-10 text-muted mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-foreground">No trend data yet</h2>
        <p className="mt-2 text-muted text-sm">
          Multiple weeks of Review Pulse data are needed to display trends.
        </p>
      </div>
    );
  }

  const volumeData = pulses.map((p, i) => ({
    label: `W${i + 1}`,
    reviews: p.total_reviews_analyzed,
    rating: p.average_rating
  }));

  const latestSnapshots = snapshots.filter((s) => s.pulse_id === pulses[pulses.length - 1]?.id);
  const uniqueThemes = [...new Set(latestSnapshots.map((s) => s.theme_name))];

  const shareData = pulses.map((p, i) => {
    const weekSnapshots = snapshots.filter((s) => s.pulse_id === p.id);
    const row: Record<string, string | number> = { label: `W${i + 1}` };
    weekSnapshots.forEach((s) => {
      row[s.theme_name] = s.theme_share_percent;
    });
    return row;
  });

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
          Review Trends
        </h1>
        <p className="mt-1 text-muted text-sm">Week-over-week analysis across {pulses.length} periods</p>
      </motion.div>

      <div className="grid lg:grid-cols-2 gap-5">
        <motion.div variants={fadeUp} className="bg-card border border-border rounded-2xl p-5">
          <h3 className="text-sm font-bold text-foreground mb-4">Review Volume</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={volumeData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted)" }} />
              <YAxis tick={{ fontSize: 11, fill: "var(--muted)" }} />
              <Tooltip
                contentStyle={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: "12px",
                  fontSize: "12px"
                }}
              />
              <Line type="monotone" dataKey="reviews" stroke="#b65f2a" strokeWidth={2.5} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </motion.div>

        <motion.div variants={fadeUp} className="bg-card border border-border rounded-2xl p-5">
          <h3 className="text-sm font-bold text-foreground mb-4">Average Rating</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={volumeData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted)" }} />
              <YAxis domain={[1, 5]} tick={{ fontSize: 11, fill: "var(--muted)" }} />
              <Tooltip
                contentStyle={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: "12px",
                  fontSize: "12px"
                }}
              />
              <Line type="monotone" dataKey="rating" stroke="#2d8a4e" strokeWidth={2.5} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </motion.div>
      </div>

      {shareData.length > 0 && uniqueThemes.length > 0 && (
        <motion.div variants={fadeUp} className="bg-card border border-border rounded-2xl p-5">
          <h3 className="text-sm font-bold text-foreground mb-4">Theme Share Over Time</h3>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={shareData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted)" }} />
              <YAxis tick={{ fontSize: 11, fill: "var(--muted)" }} />
              <Tooltip
                contentStyle={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: "12px",
                  fontSize: "12px"
                }}
              />
              {uniqueThemes.slice(0, 6).map((theme, i) => (
                <Area
                  key={theme}
                  type="monotone"
                  dataKey={theme}
                  stackId="1"
                  stroke={THEME_COLORS[i % THEME_COLORS.length]}
                  fill={THEME_COLORS[i % THEME_COLORS.length]}
                  fillOpacity={0.3}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap gap-3 mt-3">
            {uniqueThemes.slice(0, 6).map((theme, i) => (
              <span key={theme} className="flex items-center gap-1.5 text-xs text-muted">
                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ background: THEME_COLORS[i % THEME_COLORS.length] }}
                />
                {theme}
              </span>
            ))}
          </div>
        </motion.div>
      )}

      {latestSnapshots.length > 0 && (
        <motion.div variants={fadeUp}>
          <h3 className="text-sm font-bold text-foreground mb-3">Theme Status (Latest Week)</h3>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {latestSnapshots.map((s) => (
              <div
                key={s.theme_name}
                className="bg-card border border-border rounded-xl p-4 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-sm text-foreground truncate">{s.theme_name}</p>
                  <p className="text-xs text-muted mt-0.5">
                    {s.review_count} reviews &middot; {s.theme_share_percent.toFixed(1)}%
                    {s.wow_change_percent != null && (
                      <> &middot; {s.wow_change_percent > 0 ? "+" : ""}{s.wow_change_percent.toFixed(1)}% WoW</>
                    )}
                  </p>
                </div>
                <TrendBadge status={s.trend_status} />
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}
