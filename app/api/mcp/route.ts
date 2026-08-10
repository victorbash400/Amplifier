import { authenticatedBackendContext } from "@/app/lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await authenticatedBackendContext(request);
  if (!context) return Response.json({ error: "Authentication required" }, { status: 401 });
  const backend = (process.env.AMPLIFIER_BACKEND_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
  const response = await fetch(`${backend}/integrations/mcp/status`, { headers: context.headers, cache: "no-store", signal: request.signal });
  const body = await response.json().catch(() => ({ error: "Could not read MCP status" }));
  return Response.json(body, { status: response.status });
}
