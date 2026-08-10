import type { TimelineMode } from "./TimelineModeSwitcher";

export type CreatorAgentId = TimelineMode;
export type CreatorSpecialistAgentId = Exclude<CreatorAgentId, "edit">;

export type CreatorAgentRequest = {
  agentId: CreatorAgentId;
  contextNames: string[];
  nonce: string;
};

const agentNames: Record<CreatorAgentId, string> = {
  edit: "Agent",
  vision: "Vision Agent",
  hearing: "Hearing Agent",
  deafblind: "Deafblind Agent",
  sensory: "Sensory Agent",
  language: "Language Agent",
};

export function creatorAgentName(agentId: CreatorAgentId) {
  return agentNames[agentId];
}
