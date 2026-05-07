function textBlocks(out: unknown): string {
  if (!out || typeof out !== "object" || !("content" in out)) {
    return "";
  }
  const content = (out as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((b) => {
      if (b && typeof b === "object" && "type" in b && (b as { type: unknown }).type === "text") {
        return String((b as { text?: unknown }).text ?? "");
      }
      return "";
    })
    .join("")
    .trim();
}

/** Normalizes MCP `callTool` payloads (JSON-in-text from FastMCP). */
export function parseToolJsonPayload<T>(out: unknown): T {
  if (
    typeof out === "object" &&
    out !== null &&
    "structuredContent" in out &&
    typeof (out as { structuredContent?: unknown }).structuredContent === "object" &&
    (out as { structuredContent?: unknown }).structuredContent !== null
  ) {
    return (out as { structuredContent: T }).structuredContent;
  }
  const raw = textBlocks(out);
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new SyntaxError(raw ? `MCP tool JSON parse failed for: ${raw.slice(0, 200)}…` : "empty MCP payload");
  }
}
