import { authenticatedBackendContext } from "@/app/lib/session";

export const dynamic = "force-dynamic";

const backendUrl = process.env.AMPLIFIER_BACKEND_URL || "http://127.0.0.1:8000";

export async function POST(request: Request) {
  const context = await authenticatedBackendContext(request);
  if (!context) return Response.json({ error: "Authentication required" }, { status: 401 });
  const body = await request.json() as { action?: string; projectId?: string; assetId?: string; sourceAssetId?: string; sourceObjectKey?: string; sourceName?: string; contentType?: string; folderId?: string; duration?: number; strength?: number; start?: number; end?: number; source?: string; cues?: unknown[] };
  if (body.action === "noise-reduce") {
    if (!body.projectId || !body.assetId || !body.sourceAssetId || !body.sourceObjectKey || !body.sourceName || !body.contentType || body.strength === undefined) return Response.json({ error: "Noise reduction details are required" }, { status: 400 });
    const response = await fetch(`${backendUrl.replace(/\/$/, "")}/hearing/noise-reduce`, { method: "POST", headers: { "Content-Type": "application/json", ...context.headers }, body: JSON.stringify({ project_id: body.projectId, asset_id: body.assetId, source_asset_id: body.sourceAssetId, source_object_key: body.sourceObjectKey, source_name: body.sourceName, content_type: body.contentType, folder_id: body.folderId, strength: body.strength, duration: body.duration }) });
    const result = await response.json().catch(() => ({ detail: "Noise reduction failed" })) as Record<string, unknown>;
    if (!response.ok) return Response.json({ error: typeof result.detail === "string" ? result.detail : "Noise reduction failed" }, { status: response.status });
    return Response.json(result);
  }
  if (body.action !== "asl" || !body.projectId || !body.assetId || !["transcript", "description"].includes(body.source || "") || body.start === undefined || body.end === undefined) return Response.json({ error: "ASL track details are required" }, { status: 400 });
  const response = await fetch(`${backendUrl.replace(/\/$/, "")}/hearing/asl`, { method: "POST", headers: { "Content-Type": "application/json", ...context.headers }, body: JSON.stringify({ project_id: body.projectId, asset_id: body.assetId, source_object_key: body.sourceObjectKey, start: body.start, end: body.end, source: body.source, cues: body.cues }) });
  const result = await response.json().catch(() => ({ detail: "ASL generation failed" })) as Record<string, unknown>;
  if (!response.ok) return Response.json({ error: typeof result.detail === "string" ? result.detail : "ASL generation failed" }, { status: response.status });
  return Response.json(result);
}
