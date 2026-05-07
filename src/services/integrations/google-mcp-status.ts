import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { getMcpServerUrl, withMcpClient } from "../../adapters/google-mcp/mcp-session";

export type GoogleMcpStatus =
  | { ok: true; serverName?: string; serverVersion?: string; toolCount: number }
  | { ok: false; kind: "unreachable" | "error"; message: string };

/**
 * Lightweight health probe for the FastMCP sidecar. Used to surface partial-integration
 * failures when Calendar/Sheets/Gmail tools are unavailable (see Phase 4 acceptance).
 */
export async function getGoogleMcpStatus(options?: { connectTimeoutMs?: number }): Promise<GoogleMcpStatus> {
  const url = getMcpServerUrl();
  try {
    const meta = await withMcpClient(async (client: Client) => {
      const listing = await client.listTools(undefined, { timeout: 8_000 });
      const version = client.getServerVersion();
      return {
        toolCount: listing.tools.length,
        serverName: version?.name,
        serverVersion: version?.version
      };
    }, options);
    return { ok: true, ...meta };
  } catch (e) {
    const msg = describeError(e);
    if (looksLikeTransportFailure(e)) {
      return {
        ok: false,
        kind: "unreachable",
        message: `FastMCP sidecar not usable at ${url}: ${msg}`
      };
    }
    return {
      ok: false,
      kind: "error",
      message: msg
    };
  }
}

function looksLikeTransportFailure(e: unknown): boolean {
  const m = describeError(e).toLowerCase();
  return (
    m.includes("fastmcp server unreachable") ||
    m.includes("econnrefused") ||
    m.includes("fetch failed") ||
    m.includes("timeout")
  );
}

function describeError(e: unknown): string {
  if (e instanceof Error) {
    return e.message;
  }
  return String(e);
}
