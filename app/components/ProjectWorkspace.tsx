"use client";

import { useState } from "react";
import type { AmplifierProject, ProjectFile, ProjectFolder } from "../types/workspace";
import { CreatorPanel } from "./CreatorPanel";
import { FileSidebar } from "./FileSidebar";
import { TimelinePanel } from "./TimelinePanel";
import { WorkspaceCanvas } from "./WorkspaceCanvas";
import styles from "./ProjectWorkspace.module.css";

type ProjectWorkspaceProps = {
  project: AmplifierProject;
  assetsOpen: boolean;
  creatorOpen: boolean;
  folders: ProjectFolder[];
  files: ProjectFile[];
  onFoldersChange: (folders: ProjectFolder[]) => void;
  onFilesChange: (files: ProjectFile[]) => void;
};

export function ProjectWorkspace({ assetsOpen, creatorOpen, project, folders, files, onFoldersChange, onFilesChange }: ProjectWorkspaceProps) {
  const [selectedFileId, setSelectedFileId] = useState<string>();
  const selectedFile = files.find((file) => file.id === selectedFileId);
  const layout = assetsOpen ? creatorOpen ? "both" : "assets" : creatorOpen ? "creator" : "none";
  return <section className={styles.workspace} data-panel-layout={layout}>{assetsOpen && <FileSidebar files={files} folders={folders} onFilesChange={onFilesChange} onFoldersChange={onFoldersChange} onOpenFile={(file) => setSelectedFileId(file.id)} project={project} />}<WorkspaceCanvas project={project} selectedFile={selectedFile} />{creatorOpen && <CreatorPanel />}<TimelinePanel /></section>;
}
