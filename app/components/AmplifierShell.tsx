"use client";

import { useEffect, useState } from "react";
import { folderColors } from "./icons/FolderIcon";
import { NewProjectForm } from "./NewProjectForm";
import { ProjectList } from "./ProjectList";
import { ProjectWorkspace } from "./ProjectWorkspace";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { loadWorkspace, saveWorkspace } from "../lib/workspaceStorage";
import type { ProjectFile, ProjectFolder, WorkspaceData } from "../types/workspace";
import styles from "./AmplifierShell.module.css";

const initialData: WorkspaceData = { projects: [], folders: [], files: [] };

export function AmplifierShell() {
  const [data, setData] = useState<WorkspaceData>(initialData);
  const [loaded, setLoaded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState<string>();
  const [assetsOpen, setAssetsOpen] = useState(true);
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const workspace = loadWorkspace();
        const requestedId = new URLSearchParams(window.location.search).get("project") || undefined;
        setData(workspace);
        setActiveProjectId(workspace.projects.some((project) => project.id === requestedId) ? requestedId : undefined);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Could not load the workspace.");
      } finally {
        setLoaded(true);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    function restoreProject() {
      const requestedId = new URLSearchParams(window.location.search).get("project") || undefined;
      setActiveProjectId(data.projects.some((project) => project.id === requestedId) ? requestedId : undefined);
    }
    window.addEventListener("popstate", restoreProject);
    return () => window.removeEventListener("popstate", restoreProject);
  }, [data.projects]);

  function updateData(update: (current: WorkspaceData) => WorkspaceData) {
    setData((current) => {
      const next = update(current);
      try {
        saveWorkspace(next);
        setError(undefined);
      } catch {
        setError("Could not save the workspace.");
        return current;
      }
      return next;
    });
  }

  function openProject(id: string) {
    const url = new URL(window.location.href);
    url.searchParams.set("project", id);
    window.history.pushState({}, "", url);
    setActiveProjectId(id);
  }

  function openHome() {
    const url = new URL(window.location.href);
    url.searchParams.delete("project");
    window.history.pushState({}, "", url);
    setActiveProjectId(undefined);
  }

  function createProject(name: string) {
    const project = { id: crypto.randomUUID(), name, color: folderColors[data.projects.length % folderColors.length] };
    updateData((current) => ({ ...current, projects: [...current.projects, project] }));
    setCreating(false);
  }

  function deleteProject(id: string) {
    const folderIds = new Set(data.folders.filter((folder) => folder.projectId === id).map((folder) => folder.id));
    updateData((current) => ({ projects: current.projects.filter((project) => project.id !== id), folders: current.folders.filter((folder) => folder.projectId !== id), files: current.files.filter((file) => file.projectId !== id && !folderIds.has(file.folderId)) }));
  }

  function updateFolders(folders: ProjectFolder[]) {
    if (!activeProjectId) return;
    updateData((current) => ({ ...current, folders: [...current.folders.filter((folder) => folder.projectId !== activeProjectId), ...folders] }));
  }

  function updateFiles(files: ProjectFile[]) {
    if (!activeProjectId) return;
    updateData((current) => ({ ...current, files: [...current.files.filter((file) => file.projectId !== activeProjectId), ...files] }));
  }

  const activeProject = data.projects.find((project) => project.id === activeProjectId);
  if (!loaded) return null;

  return <main className={styles.shell}><WorkspaceHeader assetsOpen={assetsOpen} creatorOpen={creatorOpen} onHome={openHome} onNewProject={() => setCreating(true)} onToggleAssets={() => setAssetsOpen((current) => !current)} onToggleCreator={() => setCreatorOpen((current) => !current)} projectOpen={Boolean(activeProject)} />{creating ? <section className={styles.formArea}><NewProjectForm onCancel={() => setCreating(false)} onCreate={createProject} /></section> : activeProject ? <ProjectWorkspace assetsOpen={assetsOpen} creatorOpen={creatorOpen} files={data.files.filter((file) => file.projectId === activeProject.id)} folders={data.folders.filter((folder) => folder.projectId === activeProject.id)} onFilesChange={updateFiles} onFoldersChange={updateFolders} project={activeProject} /> : <ProjectList onDelete={deleteProject} onOpen={openProject} projects={data.projects} />}{error && <p className={styles.error} role="alert">{error}</p>}</main>;
}
