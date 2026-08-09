import { authenticatedBackendContext } from "@/app/lib/session";

export const dynamic = "force-dynamic";

const backendUrl = () => (process.env.AMPLIFIER_BACKEND_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

export async function GET(request: Request) {
  const context = await authenticatedBackendContext(request);
  if (!context) return Response.json({ error: "Authentication required" }, { status: 401 });
  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!projectId) return Response.json({ error: "Project is required" }, { status: 400 });
  const response = await fetch(`${backendUrl()}/timelines?project_id=${encodeURIComponent(projectId)}`, { headers: context.headers, cache: "no-store", signal: request.signal });
  return proxyJson(response);
}

export async function PUT(request: Request) {
  const context = await authenticatedBackendContext(request);
  if (!context) return Response.json({ error: "Authentication required" }, { status: 401 });
  const body = await request.json() as { projectId?: string; expectedRevision?: number; timeline?: Record<string, unknown> };
  if (!body.projectId || body.expectedRevision === undefined || !body.timeline) return Response.json({ error: "Project, revision, and timeline are required" }, { status: 400 });
  const response = await fetch(`${backendUrl()}/timelines`, { method: "PUT", headers: { "Content-Type": "application/json", ...context.headers }, body: JSON.stringify({ project_id: body.projectId, expected_revision: body.expectedRevision, timeline: body.timeline }), signal: request.signal });
  return proxyJson(response);
}

async function proxyJson(response: Response) {
  const body = await response.json().catch(() => ({ detail: "Timeline request failed" }));
  return Response.json(body, { status: response.status });
}
