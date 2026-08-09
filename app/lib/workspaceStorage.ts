import type { WorkspaceData } from "../types/workspace";

export async function loadWorkspace(): Promise<WorkspaceData> {
  const response = await fetch("/api/workspace", { cache: "no-store" });
  const body = await response.json().catch(() => ({ error: "Could not load the workspace" })) as Partial<WorkspaceData> & { error?: string };
  if (!response.ok) throw new Error(body.error || "Could not load the workspace");
  if (!Array.isArray(body.projects) || !Array.isArray(body.folders) || !Array.isArray(body.files)) throw new Error("The saved Amplifier workspace is invalid.");
  return { projects: body.projects, folders: body.folders, files: body.files };
}

export async function saveWorkspace(workspace: WorkspaceData) {
  const durable = { ...workspace, files: workspace.files.filter((file) => !file.pending).map((file) => ({ ...file, localUrl: undefined })) };
  const response = await fetch("/api/workspace", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(durable) });
  const result = await response.json().catch(() => ({ error: "Could not save the workspace" })) as { error?: string };
  if (!response.ok) throw new Error(result.error || "Could not save the workspace");
}
