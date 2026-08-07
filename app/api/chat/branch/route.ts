export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json() as { agentId?: string; sourceSessionId?: string; targetSessionId?: string };
  if (!body.sourceSessionId || !body.targetSessionId) {
    return Response.json({ error: "Source and target chats are required" }, { status: 400 });
  }
  const backendUrl = process.env.AMPLIFIER_BACKEND_URL || "http://127.0.0.1:8000";
  const response = await fetch(`${backendUrl.replace(/\/$/, "")}/agent/sessions/branch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agent_id: body.agentId || "general",
      source_session_id: body.sourceSessionId,
      target_session_id: body.targetSessionId,
      user_id: "local-user",
    }),
    signal: request.signal,
  });
  const result = await response.json().catch(() => ({ detail: "Could not branch chat" })) as { detail?: string; session_id?: string };
  if (!response.ok) return Response.json({ error: result.detail || "Could not branch chat" }, { status: response.status });
  return Response.json(result, { status: 201 });
}
