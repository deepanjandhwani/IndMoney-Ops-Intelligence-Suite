import { describe, expect, it } from "vitest";

import { GOOGLE_MCP_TOOL_NAMES } from "../src/adapters/google-mcp";
import { parseToolJsonPayload } from "../src/adapters/google-mcp/tool-result";

describe("parseToolJsonPayload", () => {
  it("reads structuredContent when provided", () => {
    expect(parseToolJsonPayload<{ ok: boolean }>({ structuredContent: { ok: true } })).toEqual({
      ok: true
    });
  });

  it("parses JSON from first text content block", () => {
    expect(
      parseToolJsonPayload<{ a: number }>({
        content: [{ type: "text", text: '{"a":1}' }]
      })
    ).toEqual({ a: 1 });
  });
});

describe("GOOGLE_MCP_TOOL_NAMES", () => {
  it("covers Phase 4 Google tools without a send primitive", () => {
    expect(GOOGLE_MCP_TOOL_NAMES).toContain("create_email_draft");
    expect(GOOGLE_MCP_TOOL_NAMES.some((t) => t.includes("send"))).toBe(false);
  });
});
