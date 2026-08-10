export type SkillSummary = {
  id: string;
  name: string;
  description: string;
  source: "Amplifier" | "Custom";
  editable: boolean;
};

export type SkillDetail = SkillSummary & { content: string };
export type ChatSkillsContext = { available_skills: SkillSummary[]; selected_skill_ids: string[] };

export async function loadChatSkills(projectId: string, sessionId: string): Promise<ChatSkillsContext> {
  return request(`/api/skills?projectId=${encodeURIComponent(projectId)}&sessionId=${encodeURIComponent(sessionId)}`);
}

export async function updateChatSkills(projectId: string, sessionId: string, skillIds: string[]): Promise<ChatSkillsContext> {
  return request("/api/skills", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, sessionId, skillIds }) });
}

export async function createSkill(content: string): Promise<SkillDetail> {
  return request("/api/skills", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }) });
}

export async function loadSkill(skillId: string): Promise<SkillDetail> {
  return request(`/api/skills/${encodeURIComponent(skillId)}`);
}

export async function updateSkill(skillId: string, content: string): Promise<SkillDetail> {
  return request(`/api/skills/${encodeURIComponent(skillId)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }) });
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const body = await response.json().catch(() => ({ error: "Skill request failed" })) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "Skill request failed");
  return body;
}
