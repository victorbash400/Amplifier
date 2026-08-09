export const dynamic = "force-dynamic";

const backendUrl = process.env.AMPLIFIER_BACKEND_URL || "http://127.0.0.1:8000";

export async function POST(request: Request) {
  const body = await request.json() as { action?: string; projectId?: string; assetId?: string; sourceAssetId?: string; sourceObjectKey?: string; sourceName?: string; folderId?: string; start?: number; end?: number };
  if (!body.action || !body.projectId || !body.assetId || !body.sourceAssetId || !body.sourceObjectKey || !body.sourceName || body.start === undefined || body.end === undefined) {
    return Response.json({ error: "Sensory video details are required" }, { status: 400 });
  }
  const response = await fetch(`${backendUrl.replace(/\/$/, "")}/sensory/video`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: body.action, project_id: body.projectId, asset_id: body.assetId, source_asset_id: body.sourceAssetId, source_object_key: body.sourceObjectKey, source_name: body.sourceName, folder_id: body.folderId, start: body.start, end: body.end }),
  });
  const result = await response.json().catch(() => ({ detail: "Sensory video generation failed" })) as Record<string, unknown>;
  if (!response.ok) return Response.json({ error: typeof result.detail === "string" ? result.detail : "Sensory video generation failed" }, { status: response.status });
  return Response.json(result);
}
