import { authenticatedBackendContext } from "@/app/lib/session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const context = await authenticatedBackendContext(request);
  if (!context) return Response.json({ error: "Authentication required" }, { status: 401 });
  const body = await request.json() as { agentId?: string; projectId?: string; sessionId?: string; message?: string; selectedClipIds?: string[]; playhead?: number; timelineRevision?: number; timeline?: Record<string, unknown>; timelineShot?: Record<string, unknown> };
  const message = body.message?.trim();
  if (!body.projectId || !body.sessionId || !message || body.timelineRevision === undefined || !body.timeline) return Response.json({ error: "Project, timeline, session, and message are required" }, { status: 400 });
  const backendUrl = process.env.AMPLIFIER_BACKEND_URL || "http://127.0.0.1:8000";
  const response = await fetch(`${backendUrl.replace(/\/$/, "")}/agent/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...context.headers },
    body: JSON.stringify({ agent_id: body.agentId || "general", user_id: context.account.id, session_id: body.sessionId, message, project_id: body.projectId, selected_clip_ids: body.selectedClipIds || [], playhead: body.playhead || 0, timeline_revision: body.timelineRevision, timeline: body.timeline, timeline_shot: body.timelineShot }),
    signal: request.signal,
  });
  if (!response.ok || !response.body) {
    const error = await response.json().catch(() => ({ detail: "Amplifier agent request failed" })) as { detail?: unknown };
    const detail = typeof error.detail === "string" ? error.detail : error.detail ? JSON.stringify(error.detail) : "Amplifier agent request failed";
    return Response.json({ error: detail }, { status: response.status || 502 });
  }
  return new Response(response.body, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
}
