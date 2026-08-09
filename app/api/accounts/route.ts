export async function POST(request: Request) {
  const body = await request.json() as { email?: string; password?: string; name?: string };
  const backendUrl = process.env.AMPLIFIER_BACKEND_URL || "http://127.0.0.1:8000";
  const response = await fetch(`${backendUrl.replace(/\/$/, "")}/accounts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: body.email || "", password: body.password || "", name: body.name || "" }) });
  const result = await response.json().catch(() => ({ detail: "Could not create account" })) as Record<string, unknown>;
  if (!response.ok) return Response.json({ error: typeof result.detail === "string" ? result.detail : "Could not create account" }, { status: response.status });
  return Response.json(result, { status: 201 });
}
