import Link from "next/link";

export default function SchedulerPreviewPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1
          className="text-[clamp(1.8rem,4vw,2.8rem)] font-[520] tracking-[-0.03em] leading-tight"
          style={{ fontFamily: "Georgia, 'Times New Roman', serif", color: "var(--ink-soft)" }}
        >
          Scheduler Preview
        </h1>
        <p className="mt-1 text-muted text-sm">
          Admin preview of the customer advisor scheduling flow
        </p>
      </div>
      <div className="bg-card border border-border rounded-2xl p-8 text-center space-y-4">
        <p className="text-sm text-muted">
          The live chat scheduler uses the shared state machine with theme-aware greetings, slot
          selection, secure-details collection, and booking lifecycle management.
        </p>
        <Link
          href="/customer/scheduler"
          className="inline-block bg-accent text-white font-bold px-6 py-2.5 rounded-full hover:bg-accent-strong transition-colors no-underline text-sm"
        >
          Open Customer Scheduler
        </Link>
      </div>
    </div>
  );
}
