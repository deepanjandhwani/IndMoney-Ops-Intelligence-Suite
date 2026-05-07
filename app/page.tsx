"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  Search,
  MessageSquare,
  ShieldCheck,
  ArrowRight,
  BarChart3,
  Users,
  TrendingUp,
  Star
} from "lucide-react";

const pillars = [
  {
    icon: Search,
    tag: "Pillar A",
    title: "Smart-Sync Knowledge Base",
    desc: "Ask about any mutual fund. Get cited facts from official sources — exit loads, expense ratios, lock-in periods — never opinions.",
    color: "#b65f2a"
  },
  {
    icon: MessageSquare,
    tag: "Pillar B",
    title: "Theme-Aware Advisor",
    desc: "Book an advisor call briefed by real customer sentiment. Voice and chat scheduling with live review themes.",
    color: "#2d8a4e"
  },
  {
    icon: ShieldCheck,
    tag: "Pillar C",
    title: "HITL Operations Center",
    desc: "Approve bookings with market context at a glance. Calendar, sheets, and email drafts — all synced with admin oversight.",
    color: "#2b6cb0"
  }
];

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12 } }
};

const fadeUp = {
  hidden: { opacity: 0, y: 28 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" as const } }
};

export default function HomePage() {
  return (
    <div className="min-h-screen relative overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% -10%, rgba(182,95,42,0.10) 0%, transparent 60%), radial-gradient(ellipse 50% 40% at 80% 100%, rgba(43,108,176,0.06) 0%, transparent 50%)"
        }}
      />

      <motion.section
        className="max-w-6xl mx-auto px-6 pt-24 pb-16 text-center"
        initial="hidden"
        animate="show"
        variants={container}
      >
        <motion.div variants={fadeUp}>
          <span className="inline-block text-xs font-extrabold tracking-[0.12em] uppercase text-accent mb-4">
            Groww Ops Intelligence Suite
          </span>
        </motion.div>

        <motion.h1
          variants={fadeUp}
          className="text-[clamp(2.4rem,6vw,4.8rem)] font-[520] leading-[0.95] tracking-[-0.04em] text-ink-soft max-w-4xl mx-auto"
          style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
        >
          Investor ops &amp; intelligence in one place
        </motion.h1>

        <motion.p
          variants={fadeUp}
          className="mt-6 text-muted text-[clamp(1rem,2vw,1.18rem)] leading-relaxed max-w-2xl mx-auto"
        >
          Factual fund answers from approved sources, AI-powered advisor scheduling briefed by
          customer sentiment, and a human-in-the-loop approval center — unified in a single dashboard.
        </motion.p>

        <motion.div
          variants={fadeUp}
          className="flex flex-wrap gap-4 justify-center mt-10"
        >
          <Link
            href="/customer/faq"
            className="group inline-flex items-center gap-2 bg-accent text-white font-bold px-7 py-3.5 rounded-full shadow-lg shadow-accent/20 hover:bg-accent-strong transition-all hover:-translate-y-0.5"
          >
            Customer Portal
            <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <Link
            href="/admin/review-pulse"
            className="group inline-flex items-center gap-2 bg-card border border-border font-bold px-7 py-3.5 rounded-full shadow-lg shadow-black/5 hover:border-accent/40 transition-all hover:-translate-y-0.5"
            style={{ color: "var(--ink-soft)" }}
          >
            Admin Portal
            <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </motion.div>
      </motion.section>

      <motion.section
        className="max-w-6xl mx-auto px-6 pb-16"
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.2 }}
        variants={container}
      >
        <div className="grid md:grid-cols-3 gap-5">
          {pillars.map((p) => (
            <motion.article
              key={p.tag}
              variants={fadeUp}
              whileHover={{ y: -4, transition: { duration: 0.2 } }}
              className="relative bg-card/80 backdrop-blur-sm border border-border rounded-3xl p-7 shadow-xl shadow-black/[0.04] overflow-hidden group cursor-default"
            >
              <div
                className="absolute -top-16 -right-16 w-40 h-40 rounded-full opacity-[0.07] group-hover:opacity-[0.12] transition-opacity"
                style={{ background: p.color }}
              />
              <div className="relative z-10">
                <div
                  className="w-11 h-11 rounded-2xl flex items-center justify-center mb-5"
                  style={{ background: `${p.color}14`, color: p.color }}
                >
                  <p.icon className="w-5 h-5" strokeWidth={2.2} />
                </div>
                <span className="text-[0.72rem] font-extrabold tracking-[0.1em] uppercase text-muted">
                  {p.tag}
                </span>
                <h3
                  className="mt-2 text-xl font-[540] tracking-[-0.02em] leading-snug"
                  style={{ fontFamily: "Georgia, 'Times New Roman', serif", color: "var(--ink-soft)" }}
                >
                  {p.title}
                </h3>
                <p className="mt-3 text-[0.92rem] leading-relaxed text-muted">{p.desc}</p>
              </div>
            </motion.article>
          ))}
        </div>
      </motion.section>

      <motion.section
        className="max-w-6xl mx-auto px-6 pb-20"
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.3 }}
        variants={container}
      >
        <motion.div
          variants={fadeUp}
          className="flex flex-wrap items-center justify-center gap-8 py-5 px-8 bg-card/60 backdrop-blur-sm border border-border rounded-2xl shadow-lg shadow-black/[0.03]"
        >
          {[
            { icon: BarChart3, label: "Review Intelligence", detail: "Weekly automated pulse" },
            { icon: Star, label: "Cited FAQ Answers", detail: "15+ approved sources" },
            { icon: Users, label: "Advisor Scheduling", detail: "Chat & voice booking" },
            { icon: TrendingUp, label: "Theme Tracking", detail: "Emerging trend alerts" }
          ].map((stat) => (
            <div key={stat.label} className="flex items-center gap-3 text-left">
              <stat.icon className="w-5 h-5 text-accent shrink-0" strokeWidth={2} />
              <div>
                <p className="text-sm font-bold" style={{ color: "var(--ink-soft)" }}>
                  {stat.label}
                </p>
                <p className="text-xs text-muted">{stat.detail}</p>
              </div>
            </div>
          ))}
        </motion.div>
      </motion.section>
    </div>
  );
}
