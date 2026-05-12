import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const markdownComponents: Components = {
  h1: ({ children }) => (
    <h3 className="mb-2 mt-6 text-lg font-bold text-foreground first:mt-0">{children}</h3>
  ),
  h2: ({ children }) => (
    <h3 className="mb-2 mt-5 text-base font-bold text-foreground first:mt-0">{children}</h3>
  ),
  h3: ({ children }) => (
    <h4 className="mb-2 mt-4 text-sm font-bold text-foreground first:mt-0">{children}</h4>
  ),
  h4: ({ children }) => (
    <h5 className="mb-2 mt-3 text-sm font-semibold text-foreground first:mt-0">{children}</h5>
  ),
  h5: ({ children }) => (
    <h6 className="mb-1 mt-3 text-xs font-bold uppercase tracking-wide text-muted first:mt-0">
      {children}
    </h6>
  ),
  h6: ({ children }) => (
    <h6 className="mb-1 mt-2 text-xs font-semibold text-muted first:mt-0">{children}</h6>
  ),
  p: ({ children }) => <p className="mb-4 text-sm leading-7 text-foreground last:mb-0">{children}</p>,
  ul: ({ children }) => (
    <ul className="mb-4 list-disc space-y-2 pl-5 text-sm leading-7 text-foreground marker:text-accent/80 last:mb-0">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-4 list-decimal space-y-2 pl-5 text-sm leading-7 text-foreground marker:font-semibold last:mb-0">
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li className="pl-1 [&>p]:mb-0 [&>p]:inline">{children}</li>
  ),
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic text-foreground/90">{children}</em>,
  a: ({ href, children }) => (
    <a
      href={href ?? "#"}
      className="font-semibold text-accent underline-offset-2 hover:underline"
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  ),
  code: ({ className, children }) => {
    const inline = !className;
    if (inline) {
      return (
        <code className="rounded bg-card-soft px-1.5 py-0.5 font-mono text-[0.8em] text-foreground">
          {children}
        </code>
      );
    }
    return (
      <code className={`font-mono text-xs text-foreground ${className ?? ""}`}>{children}</code>
    );
  },
  pre: ({ children }) => (
    <pre className="mb-4 overflow-x-auto rounded-xl border border-border bg-card-soft p-4 font-mono text-xs text-foreground last:mb-0">
      {children}
    </pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-4 border-l-4 border-accent/40 pl-4 text-sm italic text-muted last:mb-0">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-6 border-border" />,
  table: ({ children }) => (
    <div className="mb-4 overflow-x-auto rounded-xl border border-border last:mb-0">
      <table className="w-full min-w-[16rem] text-left text-xs text-foreground">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-card-soft font-semibold">{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => <tr className="border-b border-border last:border-b-0">{children}</tr>,
  th: ({ children }) => <th className="border-border px-3 py-2">{children}</th>,
  td: ({ children }) => <td className="border-border px-3 py-2 align-top">{children}</td>,
  img: ({ src, alt }) =>
    src ? (
      // eslint-disable-next-line @next/next/no-img-element -- Markdown allows arbitrary URLs; next/image needs domain allowlist
      <img
        src={src}
        alt={alt ?? ""}
        className="my-2 max-h-64 max-w-full rounded-lg border border-border object-contain"
        loading="lazy"
      />
    ) : null
};

type WeeklySummaryBodyProps = {
  text: string;
  className?: string;
};

export function WeeklySummaryBody({ text, className = "" }: WeeklySummaryBodyProps) {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {trimmed}
      </ReactMarkdown>
    </div>
  );
}
