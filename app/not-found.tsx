import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <div className="bg-card border border-border rounded-3xl shadow-xl shadow-black/[0.04] p-12 max-w-lg text-center">
        <span className="text-xs font-extrabold tracking-[0.12em] uppercase text-accent">
          404
        </span>
        <h1
          className="mt-3 text-3xl font-[520] tracking-[-0.03em]"
          style={{ fontFamily: "Georgia, 'Times New Roman', serif", color: "var(--ink-soft)" }}
        >
          Page not found
        </h1>
        <p className="mt-4 text-muted leading-relaxed">
          The address may be wrong or the page may have moved.
        </p>
        <Link
          href="/"
          className="inline-block mt-6 bg-accent text-white font-bold px-6 py-3 rounded-full hover:bg-accent-strong transition-colors no-underline"
        >
          Back to Home
        </Link>
      </div>
    </div>
  );
}
