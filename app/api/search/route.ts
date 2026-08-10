import { authenticatedBackendContext } from "@/app/lib/session";

export const dynamic = "force-dynamic";

const backendUrl = process.env.AMPLIFIER_BACKEND_URL || "http://127.0.0.1:8000";

export async function GET(request: Request) {
  const context = await authenticatedBackendContext(request);
  if (!context) return Response.json({ error: "Authentication required" }, { status: 401 });
  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!projectId) return Response.json({ error: "Project is required" }, { status: 400 });
  const endpoint = new URL(`${backendUrl.replace(/\/$/, "")}/search/index`);
  endpoint.searchParams.set("project_id", projectId);
  return proxy(endpoint, { method: "GET", cache: "no-store", headers: context.headers });
}

export async function POST(request: Request) {
  const context = await authenticatedBackendContext(request);
  if (!context) return Response.json({ error: "Authentication required" }, { status: 401 });
  const body = await request.json() as { action?: "index" | "search" | "transcript" | "braille"; projectId?: string; assets?: Array<{ assetId: string; objectKey: string; name: string; contentType: string; folderId: string; duration?: number; force?: boolean }>; query?: string; assetId?: string; objectKey?: string };
  if (!body.projectId || !body.action) return Response.json({ error: "Media search request details are required" }, { status: 400 });
  if (body.action === "search") {
    return proxy(new URL(`${backendUrl.replace(/\/$/, "")}/search/query`), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...context.headers },
      body: JSON.stringify({ project_id: body.projectId, query: body.query }),
    });
  }
  if (body.action === "transcript" || body.action === "braille") {
    return proxy(new URL(`${backendUrl.replace(/\/$/, "")}/search/${body.action}`), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...context.headers },
      body: JSON.stringify({ project_id: body.projectId, asset_id: body.assetId, object_key: body.objectKey }),
    });
  }
  if (!body.assets?.length) return Response.json({ error: "At least one media asset is required" }, { status: 400 });
  const response = await fetch(new URL(`${backendUrl.replace(/\/$/, "")}/search/index/batch`), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...context.headers },
    body: JSON.stringify({ assets: body.assets.map((asset) => ({ project_id: body.projectId, asset_id: asset.assetId, object_key: asset.objectKey, name: asset.name, content_type: asset.contentType, folder_id: asset.folderId, duration: asset.duration, force: asset.force })) }),
  });
  return new Response(response.body, { status: response.status, headers: { "Content-Type": response.headers.get("Content-Type") || "application/x-ndjson", "Cache-Control": "no-store" } });
}

async function proxy(url: URL, init: RequestInit) {
  const response = await fetch(url, init);
  const result = await response.json().catch(() => ({ detail: "Media search request failed" })) as Record<string, unknown>;
  if (!response.ok) return Response.json({ error: typeof result.detail === "string" ? result.detail : "Media search request failed" }, { status: response.status });
  return Response.json(result);
}
