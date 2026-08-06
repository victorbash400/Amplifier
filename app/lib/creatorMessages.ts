import type { CreatorBlock, CreatorMessage, CreatorToolCall } from "../components/creatorChatTypes";
import type { CreatorStreamEvent } from "./creatorStream";

export function applyCreatorEvent(messages: CreatorMessage[], event: CreatorStreamEvent) {
  if (event.type === "done" || event.type === "title") return finishReasoning(messages);
  const current = ensureAssistant(messages);
  if (event.type === "content" || event.type === "reasoning") return updateLast(current, (blocks) => appendText(blocks, event.type === "content" ? "text" : "reasoning", event.content));
  if (event.type === "tool_call") return updateLast(current, (blocks) => upsertTool(blocks, { id: event.id, name: event.name, status: "running", detail: summarize(event.args), args: event.args }));
  if (event.type === "tool_response") return updateLast(current, (blocks) => {
    const previous = blocks.find((block) => block.kind === "tool" && block.tool.id === event.id);
    return upsertTool(blocks, { id: event.id, name: event.name, status: event.result.status === "failed" ? "error" : "done", detail: summarize(event.result), args: previous?.kind === "tool" ? previous.tool.args : undefined });
  });
  return updateLast(current, (blocks) => [...finishBlocks(blocks), { id: crypto.randomUUID(), kind: "text", content: `Error: ${event.error}` }]);
}

export function finishReasoning(messages: CreatorMessage[]) {
  return messages.map((message) => message.role === "assistant" ? { ...message, blocks: finishBlocks(message.blocks) } : message);
}

function ensureAssistant(messages: CreatorMessage[]) {
  return messages.at(-1)?.role === "assistant" ? messages : [...messages, { id: crypto.randomUUID(), role: "assistant" as const, blocks: [] }];
}

function updateLast(messages: CreatorMessage[], update: (blocks: CreatorBlock[]) => CreatorBlock[]) {
  return messages.map((message, index) => index === messages.length - 1 ? { ...message, blocks: update(message.blocks) } : message);
}

function appendText(blocks: CreatorBlock[], kind: "text" | "reasoning", content: string) {
  const finished = kind === "text" ? finishBlocks(blocks) : blocks;
  const last = finished.at(-1);
  if (last?.kind === kind) return finished.map((block, index) => index === finished.length - 1 ? { ...last, content: last.content + content } : block);
  return [...finished, { id: crypto.randomUUID(), kind, content, ...(kind === "reasoning" ? { startedAt: Date.now() } : {}) }];
}

function upsertTool(blocks: CreatorBlock[], tool: CreatorToolCall): CreatorBlock[] {
  const finished = finishBlocks(blocks);
  const id = `tool-${tool.id}`;
  if (finished.some((block) => block.id === id)) return finished.map((block): CreatorBlock => block.id === id ? { id, kind: "tool", tool } : block);
  return [...finished, { id, kind: "tool", tool }];
}

function finishBlocks(blocks: CreatorBlock[]) {
  const now = Date.now();
  return blocks.map((block) => block.kind === "reasoning" && !block.finishedAt ? { ...block, finishedAt: now } : block);
}

function summarize(value: Record<string, unknown>) {
  const text = Object.entries(value).slice(0, 2).map(([key, item]) => `${key}: ${typeof item === "string" ? item : JSON.stringify(item)}`).join(" · ");
  return text.length > 110 ? `${text.slice(0, 107)}...` : text;
}
