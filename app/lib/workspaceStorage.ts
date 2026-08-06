import type { WorkspaceData } from "../types/workspace";

const storageKey = "amplifier-workspace";
const emptyWorkspace: WorkspaceData = { projects: [], folders: [], files: [] };

export function loadWorkspace(): WorkspaceData {
  const stored = window.localStorage.getItem(storageKey);
  if (!stored) return emptyWorkspace;

  const parsed = JSON.parse(stored) as Partial<WorkspaceData>;
  if (!Array.isArray(parsed.projects) || !Array.isArray(parsed.folders) || !Array.isArray(parsed.files)) {
    throw new Error("The saved Amplifier workspace is invalid.");
  }
  return { projects: parsed.projects, folders: parsed.folders, files: parsed.files };
}

export function saveWorkspace(workspace: WorkspaceData) {
  const durable = {
    ...workspace,
    files: workspace.files.filter((file) => !file.pending).map((file) => ({ ...file, localUrl: undefined })),
  };
  window.localStorage.setItem(storageKey, JSON.stringify(durable));
}
