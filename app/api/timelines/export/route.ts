import { authenticatedBackendContext } from "@/app/lib/session";

export const dynamic = "force-dynamic";
const backendUrl = process.env.AMPLIFIER_BACKEND_URL || "http://127.0.0.1:8000";

type ExportClip = {
  assetId?: string;
  objectKey?: string;
  name?: string;
  contentType?: string;
  start?: number;
  duration?: number;
  sourceDuration?: number;
  trimStart?: number;
  lane?: number;
  role?: "visual" | "audio";
  volume?: number;
  contrast?: number;
  colorPreset?: string;
};

type ExportCaption = { id?: string; start?: number; end?: number; text?: string };

export async function POST(request: Request) {
  const context = await authenticatedBackendContext(request);
  if (!context) return Response.json({ error: "Authentication required" }, { status: 401 });
  const body = await request.json() as { projectId?: string; folderId?: string; name?: string; clips?: ExportClip[]; captions?: ExportCaption[] };
  if (!body.projectId || !body.name?.trim() || !body.clips?.length) return Response.json({ error: "Export name, project, and timeline clips are required" }, { status: 400 });
  const response = await fetch(`${backendUrl.replace(/\/$/, "")}/timelines/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...context.headers },
    body: JSON.stringify({
      project_id: body.projectId,
      folder_id: body.folderId || "root",
      name: body.name,
      captions: body.captions,
      clips: body.clips.map((clip) => ({
        asset_id: clip.assetId,
        object_key: clip.objectKey,
        name: clip.name,
        content_type: clip.contentType,
        start: clip.start,
        duration: clip.duration,
        source_duration: clip.sourceDuration,
        trim_start: clip.trimStart,
        lane: clip.lane,
        role: clip.role,
        volume: clip.volume,
        contrast: clip.contrast,
        color_preset: clip.colorPreset,
      })),
    }),
  });
  const result = await response.json().catch(() => ({ detail: "Timeline export failed" })) as Record<string, unknown>;
  if (!response.ok) return Response.json({ error: typeof result.detail === "string" ? result.detail : "Timeline export failed" }, { status: response.status });
  return Response.json(result, { status: 201 });
}
