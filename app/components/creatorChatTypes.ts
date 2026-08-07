export type CreatorToolCall = {
  id: string;
  name: string;
  status: "running" | "done" | "error";
  detail?: string;
  args?: Record<string, unknown>;
};

export type CreatorBlock =
  | { id: string; kind: "text"; content: string }
  | { id: string; kind: "reasoning"; content: string; startedAt?: number; finishedAt?: number }
  | { id: string; kind: "tool"; tool: CreatorToolCall };

export type CreatorMessage = {
  id: string;
  role: "user" | "assistant";
  blocks: CreatorBlock[];
};

export type CreatorChat = {
  id: string;
  projectId: string;
  title: string;
  messages: CreatorMessage[];
  createdAt: number;
  updatedAt: number;
  agentId?: import("./creatorAgentTypes").CreatorAgentId;
  contextNames?: string[];
};
