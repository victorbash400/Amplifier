import { authenticatedBackendContext } from "@/app/lib/session";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const context = await authenticatedBackendContext(request);
  if (!context) return Response.json({ error: "Authentication required" }, { status: 401 });
  const { sessionId } = await params;
  const backendUrl = (process.env.AMPLIFIER_BACKEND_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
  const response = await fetch(`${backendUrl}/agent/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
    headers: context.headers,
    signal: request.signal,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: "Could not delete chat" })) as { detail?: string };
    return Response.json({ error: body.detail || "Could not delete chat" }, { status: response.status });
  }
  return new Response(null, { status: 204 });
}
