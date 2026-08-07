import type { CreatorChat } from "../components/creatorChatTypes";
import type { CreatorAgentId } from "../components/creatorAgentTypes";

const storageKey = "amplifier-creator-chats";

export function createCreatorChat(projectId: string, agentId: CreatorAgentId = "general", contextNames: string[] = []): CreatorChat {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    projectId,
    title: "New chat",
    messages: [],
    createdAt: now,
    updatedAt: now,
    agentId,
    contextNames,
  };
}

export function loadCreatorChats(projectId: string): CreatorChat[] {
  const stored = window.localStorage.getItem(storageKey);
  if (!stored) return [];
  const parsed = JSON.parse(stored) as unknown;
  if (!Array.isArray(parsed)) throw new Error("The saved Creator chats are invalid.");
  return (parsed as CreatorChat[])
    .filter((chat) => chat.projectId === projectId)
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

export function saveCreatorChats(projectId: string, chats: CreatorChat[]) {
  const stored = window.localStorage.getItem(storageKey);
  const allChats = stored ? JSON.parse(stored) as CreatorChat[] : [];
  if (!Array.isArray(allChats)) throw new Error("The saved Creator chats are invalid.");
  window.localStorage.setItem(storageKey, JSON.stringify([
    ...allChats.filter((chat) => chat.projectId !== projectId),
    ...chats,
  ]));
}
