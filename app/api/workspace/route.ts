import { authenticatedAccount } from "@/app/lib/session";

const backendUrl = process.env.AMPLIFIER_BACKEND_URL || "http://127.0.0.1:8000";

export async function GET(request: Request) {
  const account = await authenticatedAccount(request);
  if (!account) return Response.json({ error: "Authentication required" }, { status: 401 });
  return proxy("/workspace/read", {}, account.id);
}

export async function PUT(request: Request) {
  const account = await authenticatedAccount(request);
  if (!account) return Response.json({ error: "Authentication required" }, { status: 401 });
  const workspace = await request.json();
  return proxy("/workspace", { workspace }, account.id, "PUT");
}

async function proxy(path: string, body: Record<string, unknown>, accountId: string, method = "POST") {
  const internalSecret = process.env.AMPLIFIER_INTERNAL_SECRET;
  if (!internalSecret) return Response.json({ error: "Amplifier internal authentication is not configured" }, { status: 503 });
  const response = await fetch(`${backendUrl.replace(/\/$/, "")}${path}`, { method, headers: { "Content-Type": "application/json", "X-Amplifier-Account": accountId, "X-Amplifier-Internal-Secret": internalSecret }, body: JSON.stringify(body), cache: "no-store" });
  const result = await response.json().catch(() => ({ detail: "Workspace request failed" })) as Record<string, unknown>;
  if (!response.ok) return Response.json({ error: typeof result.detail === "string" ? result.detail : "Workspace request failed" }, { status: response.status });
  return Response.json(result);
}
