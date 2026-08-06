export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json() as { projectId?: string; sessionId?: string; message?: string };
  const message = body.message?.trim();
  if (!body.projectId || !body.sessionId || !message) return Response.json({ error: "Project, session, and message are required" }, { status: 400 });
  const backendUrl = process.env.AMPLIFIER_BACKEND_URL || "http://127.0.0.1:8000";
  const response = await fetch(`${backendUrl.replace(/\/$/, "")}/agent/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: "local-user", session_id: body.sessionId, message }),
    signal: request.signal,
  });
  if (!response.ok || !response.body) {
    const error = await response.json().catch(() => ({ detail: "Amplifier agent request failed" })) as { detail?: unknown };
    const detail = typeof error.detail === "string" ? error.detail : error.detail ? JSON.stringify(error.detail) : "Amplifier agent request failed";
    return Response.json({ error: detail }, { status: response.status || 502 });
  }
  return new Response(response.body, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
}
