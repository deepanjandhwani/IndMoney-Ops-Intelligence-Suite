import { describe, expect, it, vi } from "vitest";

import { getGoogleMcpStatus } from "../src/services/integrations/google-mcp-status";

describe("getGoogleMcpStatus", () => {
  it("reports unreachable when no server listens", async () => {
    vi.stubEnv("MCP_SERVER_URL", "http://127.0.0.1:57931/sse");
    const s = await getGoogleMcpStatus({ connectTimeoutMs: 1500 });
    expect(s.ok).toBe(false);
    if (!s.ok) {
      expect(s.kind).toBe("unreachable");
      expect(s.message.toLowerCase()).toMatch(/fastmcp|econnrefused|unreachable|fetch failed/i);
    }
    vi.unstubAllEnvs();
  });
});
