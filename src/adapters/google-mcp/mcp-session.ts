import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

import { FastMcpUnavailableError as Unreachable } from "./errors";
import { McpToolExecutionError } from "./errors";
import { parseToolJsonPayload } from "./tool-result";

const DEFAULT_MCP_SERVER_URL = "http://127.0.0.1:8000/sse";
const DEFAULT_CONNECT_MS = 10_000;

export function getMcpServerUrl(): string {
  return (process.env.MCP_SERVER_URL || DEFAULT_MCP_SERVER_URL).trim();
}

function isLikelyTransportFailure(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    return false;
  }
  const e = err as NodeJS.ErrnoException & { cause?: unknown };
  if (e.code === "ECONNREFUSED" || e.code === "ENOTFOUND" || e.code === "ETIMEDOUT") {
    return true;
  }
  const msg = typeof e.message === "string" ? e.message : "";
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|fetch failed|network/i.test(msg)) {
    return true;
  }
  if (e.cause) {
    return isLikelyTransportFailure(e.cause);
  }
  return false;
}

export async function withMcpClient<T>(
  fn: (client: Client) => Promise<T>,
  options?: { connectTimeoutMs?: number }
): Promise<T> {
  const url = getMcpServerUrl();
  const transport = new SSEClientTransport(new URL(url));
  const client = new Client({ name: "groww-ops-app", version: "1.0.0" });
  const connectTimeoutMs = options?.connectTimeoutMs ?? DEFAULT_CONNECT_MS;
  try {
    await client.connect(transport, { timeout: connectTimeoutMs });
    return await fn(client);
  } catch (err) {
    if (isLikelyTransportFailure(err)) {
      throw new Unreachable(
        `FastMCP server unreachable at ${url}. Start the Python sidecar (see mcp/README.md).`,
        err
      );
    }
    throw err;
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function callMcpToolJson<T>(
  toolName: string,
  args: Record<string, unknown>,
  options?: { connectTimeoutMs?: number; callTimeoutMs?: number }
): Promise<T> {
  return withMcpClient((client) => invokeToolJson<T>(client, toolName, args, options?.callTimeoutMs), {
    connectTimeoutMs: options?.connectTimeoutMs
  });
}

async function invokeToolJson<T>(
  client: Client,
  toolName: string,
  args: Record<string, unknown>,
  callTimeoutMs?: number
): Promise<T> {
  const res = await client.callTool(
    { name: toolName, arguments: args },
    undefined,
    { timeout: callTimeoutMs ?? 120_000 }
  );
  if ("isError" in res && res.isError) {
    const msg = tryErrorText(res);
    throw new McpToolExecutionError(toolName, msg || "MCP tool returned isError without text");
  }
  return parseToolJsonPayload<T>(res as unknown);
}

function tryErrorText(res: unknown): string {
  if (!res || typeof res !== "object" || !("content" in res)) {
    return "";
  }
  const content = (res as { content?: unknown }).content;
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
