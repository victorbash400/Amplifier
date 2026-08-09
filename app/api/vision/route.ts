import { authenticatedBackendContext } from "@/app/lib/session";

export const dynamic = "force-dynamic";

const backendUrl = process.env.AMPLIFIER_BACKEND_URL || "http://127.0.0.1:8000";

export async function POST(request: Request) {
  const context = await authenticatedBackendContext(request);
  if (!context) return Response.json({ error: "Authentication required" }, { status: 401 });
  const body = await request.json() as { action?: string; preset?: string; projectId?: string; assetId?: string; sourceAssetId?: string; sourceObjectKey?: string; sourceName?: string; contentType?: string; folderId?: string; start?: number; end?: number };
  if (!body.projectId || !body.assetId || !body.sourceAssetId || !body.action || body.start === undefined || body.end === undefined) return Response.json({ error: "Vision narration details are required" }, { status: 400 });
  const filter = body.action === "contrast" || body.action === "color-safe";
  if (filter && (!body.sourceObjectKey || !body.sourceName || !body.contentType)) return Response.json({ error: "Vision filter source details are required" }, { status: 400 });
  const response = await fetch(`${backendUrl.replace(/\/$/, "")}/vision/${filter ? "filter" : "narration"}`, { method: "POST", headers: { "Content-Type": "application/json", ...context.headers }, body: JSON.stringify({ project_id: body.projectId, asset_id: body.assetId, source_asset_id: body.sourceAssetId, source_object_key: body.sourceObjectKey, source_name: body.sourceName, content_type: body.contentType, folder_id: body.folderId, action: body.action, preset: body.preset, start: body.start, end: body.end }) });
  const result = await response.json().catch(() => ({ detail: "Vision narration failed" })) as Record<string, unknown>;
  if (!response.ok) return Response.json({ error: typeof result.detail === "string" ? result.detail : "Vision narration failed" }, { status: response.status });
  return Response.json(result);
}
