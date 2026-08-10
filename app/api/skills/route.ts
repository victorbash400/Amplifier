import { authenticatedBackendContext } from "@/app/lib/session";

export const dynamic = "force-dynamic";

const backendUrl = () => (process.env.AMPLIFIER_BACKEND_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

export async function GET(request: Request) {
  const context = await authenticatedBackendContext(request);
  if (!context) return Response.json({ error: "Authentication required" }, { status: 401 });
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");
  const sessionId = url.searchParams.get("sessionId");
  if (!projectId || !sessionId) return Response.json({ error: "Project and chat are required" }, { status: 400 });
  const response = await fetch(`${backendUrl()}/skills/context?project_id=${encodeURIComponent(projectId)}&session_id=${encodeURIComponent(sessionId)}`, { headers: context.headers, cache: "no-store", signal: request.signal });
  return proxy(response);
}

export async function POST(request: Request) {
  const context = await authenticatedBackendContext(request);
  if (!context) return Response.json({ error: "Authentication required" }, { status: 401 });
  const body = await request.json() as { content?: string };
  if (!body.content?.trim()) return Response.json({ error: "Skill instructions are required" }, { status: 400 });
  const response = await fetch(`${backendUrl()}/skills`, { method: "POST", headers: { "Content-Type": "application/json", ...context.headers }, body: JSON.stringify({ content: body.content }), signal: request.signal });
  return proxy(response);
}

export async function PUT(request: Request) {
  const context = await authenticatedBackendContext(request);
  if (!context) return Response.json({ error: "Authentication required" }, { status: 401 });
  const body = await request.json() as { projectId?: string; sessionId?: string; skillIds?: string[] };
  if (!body.projectId || !body.sessionId || !Array.isArray(body.skillIds)) return Response.json({ error: "Project, chat, and skills are required" }, { status: 400 });
  const response = await fetch(`${backendUrl()}/skills/context`, { method: "PUT", headers: { "Content-Type": "application/json", ...context.headers }, body: JSON.stringify({ project_id: body.projectId, session_id: body.sessionId, skill_ids: body.skillIds }), signal: request.signal });
  return proxy(response);
}

async function proxy(response: Response) {
  const body = await response.json().catch(() => ({ detail: "Skill request failed" })) as { detail?: unknown };
  if (!response.ok) return Response.json({ error: typeof body.detail === "string" ? body.detail : "Skill request failed" }, { status: response.status });
  return Response.json(body, { status: response.status });
}
