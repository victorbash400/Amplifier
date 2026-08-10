export type McpStatus = { status: "connected" | "disconnected"; name: string; tools: string[]; error?: string };

export async function loadMcpStatus(): Promise<McpStatus> {
  const response = await fetch("/api/mcp", { cache: "no-store" });
  const body = await response.json().catch(() => ({ error: "Could not read MCP status" })) as McpStatus & { error?: string };
  if (!response.ok) throw new Error(body.error || "Could not read MCP status");
  return body;
}
