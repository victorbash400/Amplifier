export const dynamic = "force-dynamic";

type UploadBody = {
  projectId?: string;
  assetId?: string;
  fileName?: string;
  contentType?: string;
  size?: number;
};

export async function POST(request: Request) {
  const body = await request.json() as UploadBody;
  if (!validUpload(body)) return Response.json({ error: "Project, asset, file name, type, and size are required" }, { status: 400 });
  return proxy("/assets/uploads", {
    project_id: body.projectId,
    asset_id: body.assetId,
    file_name: body.fileName,
    content_type: body.contentType,
    size: body.size,
    origin: new URL(request.url).origin,
  });
}

export async function PATCH(request: Request) {
  const body = await request.json() as UploadBody;
  if (!body.projectId || !body.assetId || !body.fileName || !body.size) return Response.json({ error: "Project, asset, file name, and size are required" }, { status: 400 });
  return proxy("/assets/uploads/complete", {
    project_id: body.projectId,
    asset_id: body.assetId,
    file_name: body.fileName,
    size: body.size,
  });
}

export async function DELETE(request: Request) {
  const body = await request.json() as { projectId?: string; objectKey?: string };
  if (!body.projectId || !body.objectKey) return Response.json({ error: "Project and object key are required" }, { status: 400 });
  return proxy("/assets", { project_id: body.projectId, object_key: body.objectKey }, "DELETE");
}

function validUpload(body: UploadBody): body is Required<UploadBody> {
  return Boolean(body.projectId && body.assetId && body.fileName && body.contentType && body.size && body.size > 0);
}

async function proxy(path: string, body: Record<string, unknown>, method = "POST") {
  const backendUrl = process.env.AMPLIFIER_BACKEND_URL || "http://127.0.0.1:8000";
  const response = await fetch(`${backendUrl.replace(/\/$/, "")}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({ detail: "Asset upload request failed" })) as Record<string, unknown>;
  if (!response.ok) return Response.json({ error: typeof result.detail === "string" ? result.detail : "Asset upload request failed" }, { status: response.status });
  return Response.json(result);
}
