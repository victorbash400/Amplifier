import type { TimelineMode } from "./TimelineModeSwitcher";

export type CreatorAgentId = "general" | TimelineMode;

export type CreatorAgentRequest = {
  agentId: CreatorAgentId;
  contextNames: string[];
  nonce: string;
};

const agentNames: Record<CreatorAgentId, string> = {
  general: "General Agent",
  edit: "Edit Agent",
  vision: "Vision Agent",
  hearing: "Hearing Agent",
  deafblind: "Deafblind Agent",
  sensory: "Sensory Agent",
  language: "Language Agent",
};

export function creatorAgentName(agentId: CreatorAgentId) {
  return agentNames[agentId];
}
