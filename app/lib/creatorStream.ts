export type CreatorStreamEvent =
  | { type: "content"; content: string }
  | { type: "reasoning"; content: string }
  | { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_response"; id: string; name: string; result: Record<string, unknown> }
  | { type: "title"; title: string }
  | { type: "error"; error: string }
  | { type: "done" };

export async function streamCreatorMessage({ agentId, message, onEvent, playhead, projectId, selectedClipIds, sessionId, signal, timeline, timelineRevision, timelineShot }: { agentId: string; message: string; onEvent: (event: CreatorStreamEvent) => void | Promise<void>; playhead: number; projectId: string; selectedClipIds: string[]; sessionId: string; signal?: AbortSignal; timeline: Record<string, unknown>; timelineRevision: number; timelineShot?: import("./timelineShot").TimelineShot }) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ agentId, message, playhead, projectId, selectedClipIds, sessionId, timeline, timelineRevision, timelineShot }),
    signal,
  });
  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => ({ error: "Creator chat failed" })) as { error?: string };
    throw new Error(body.error || "Creator chat failed");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() || "";
    for (const block of blocks) {
      const data = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("");
      if (data) await onEvent(JSON.parse(data) as CreatorStreamEvent);
    }
    if (done) break;
  }
}
