import type { CreatorAgentId } from "../components/creatorAgentTypes";

export async function branchCreatorSession(sourceSessionId: string, targetSessionId: string, agentId: CreatorAgentId) {
  const response = await fetch("/api/chat/branch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentId, sourceSessionId, targetSessionId }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "Could not branch chat" })) as { error?: string };
    throw new Error(body.error || "Could not branch chat");
  }
}

export async function deleteCreatorSession(sessionId: string) {
  const response = await fetch(`/api/chat/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "Could not delete chat" })) as { error?: string };
    throw new Error(body.error || "Could not delete chat");
  }
}
