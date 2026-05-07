/** Thrown when the FastMCP sidecar cannot be reached (connection / timeout). */
export class FastMcpUnavailableError extends Error {
  readonly integrationCode = "fastmcp_unavailable" as const;

  readonly causeUnknown: unknown;

  constructor(message: string, causeUnknown?: unknown) {
    super(message);
    this.name = "FastMcpUnavailableError";
    this.causeUnknown = causeUnknown;
  }
}

export function isFastMcpUnavailableError(e: unknown): e is FastMcpUnavailableError {
  return e instanceof FastMcpUnavailableError;
}

/** Tool execution failed (`isError` or invalid payload). */
export class McpToolExecutionError extends Error {
  readonly toolName: string;

  constructor(toolName: string, message: string) {
    super(message);
    this.name = "McpToolExecutionError";
    this.toolName = toolName;
  }
}
