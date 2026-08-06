export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");
  const objectKey = url.searchParams.get("objectKey");
  if (!projectId || !objectKey) return Response.json({ error: "Project and object key are required" }, { status: 400 });
  const backendUrl = process.env.AMPLIFIER_BACKEND_URL || "http://127.0.0.1:8000";
  const endpoint = new URL(`${backendUrl.replace(/\/$/, "")}/assets/media`);
  endpoint.searchParams.set("project_id", projectId);
  endpoint.searchParams.set("object_key", objectKey);
  const range = request.headers.get("Range");
  if (range) endpoint.searchParams.set("range", range);
  const response = await fetch(endpoint, { cache: "no-store" });
  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => ({ detail: "Could not load asset" })) as { detail?: string };
    return Response.json({ error: body.detail || "Could not load asset" }, { status: response.status });
  }
  const headers = new Headers({ "Content-Type": response.headers.get("Content-Type") || "application/octet-stream", "Accept-Ranges": "bytes", "Cache-Control": response.headers.get("Cache-Control") || "private, max-age=86400" });
  for (const name of ["Content-Length", "Content-Range", "ETag"]) {
    const value = response.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(response.body, { status: response.status, headers });
}
