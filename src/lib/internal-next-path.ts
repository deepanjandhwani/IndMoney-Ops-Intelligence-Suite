/** Reject open redirects: only same-origin paths starting with a single "/". */
export function safeInternalNextPath(next: string | null | undefined, fallback: string): string {
  const n = (next ?? fallback).trim();
  if (!n.startsWith("/") || n.startsWith("//")) return fallback;
  return n;
}
