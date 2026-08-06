"use client";

import { ChangeEvent, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Plus, Search, Upload } from "lucide-react";
import type { AmplifierProject, ProjectFile, ProjectFolder } from "../types/workspace";
import { FileRow } from "./FileRow";
import { FolderRow } from "./FolderRow";
import { FolderIcon, folderColors } from "./icons/FolderIcon";
import styles from "./FileSidebar.module.css";

type FileSidebarProps = {
  project: AmplifierProject;
  folders: ProjectFolder[];
  files: ProjectFile[];
  onFoldersChange: (folders: ProjectFolder[]) => void;
  onFilesChange: (files: ProjectFile[]) => void;
  onOpenFile: (file: ProjectFile) => void;
};

export function FileSidebar({ project, folders, files, onFoldersChange, onFilesChange, onOpenFile }: FileSidebarProps) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("root");
  const [expanded, setExpanded] = useState(() => new Set(["root"]));
  const normalizedQuery = query.trim().toLowerCase();
  const visibleFiles = useMemo(() => files.filter((file) => file.name.toLowerCase().includes(normalizedQuery)), [files, normalizedQuery]);
  const visibleFolders = useMemo(() => folders.filter((folder) => folder.name.toLowerCase().includes(normalizedQuery) || hasMatchingDescendant(folder.id, folders, visibleFiles)), [folders, normalizedQuery, visibleFiles]);

  function toggle(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function createFolder(parentId = selectedId) {
    const count = folders.filter((folder) => folder.name.startsWith("New folder")).length;
    const folder: ProjectFolder = { id: crypto.randomUUID(), projectId: project.id, name: count ? `New folder ${count + 1}` : "New folder", color: folderColors[folders.length % folderColors.length], parentId: parentId === "root" ? undefined : parentId };
    onFoldersChange([...folders, folder]);
    setExpanded((current) => new Set(current).add("root").add(parentId));
    setSelectedId(folder.id);
  }

  function deleteFolder(id: string) {
    const removed = descendantsOf(id, folders);
    onFoldersChange(folders.filter((folder) => !removed.has(folder.id)));
    onFilesChange(files.filter((file) => !removed.has(file.folderId)));
    setSelectedId("root");
  }

  function upload(event: ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files || []);
    if (!selectedFiles.length) return;
    onFilesChange([...files, ...selectedFiles.map((file): ProjectFile => ({ id: crypto.randomUUID(), projectId: project.id, folderId: selectedId, name: file.name, size: file.size, type: file.type }))]);
    event.target.value = "";
    setExpanded((current) => new Set(current).add(selectedId));
  }

  const rootExpanded = expanded.has("root");
  return <aside className={styles.sidebar} aria-label="Assets"><section className={styles.search}><Search size={14} /><input aria-label="Search assets" onChange={(event) => setQuery(event.target.value)} placeholder="Search" value={query} /></section><nav className={styles.actions} aria-label="Asset actions"><label aria-label="Upload files" title="Upload files"><Upload size={16} /><input multiple onChange={upload} type="file" /></label><button aria-label="New folder" onClick={() => createFolder()} title="New folder" type="button"><Plus size={16} /></button></nav><nav className={styles.tree} aria-label="Asset tree"><p className={styles.folderRow} data-selected={selectedId === "root"}><button aria-label={`${rootExpanded ? "Collapse" : "Expand"} ${project.name}`} className={styles.chevron} onClick={() => toggle("root")} type="button">{rootExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button><button className={styles.folderName} onClick={() => setSelectedId("root")} type="button"><FolderIcon color={project.color} /><strong>{project.name}</strong></button><button aria-label="New folder in project" className={styles.rowAction} onClick={() => createFolder("root")} type="button"><Plus size={15} /></button></p>{rootExpanded && visibleFiles.filter((file) => file.folderId === "root").map((file) => <FileRow file={file} key={file.id} onDelete={(id) => onFilesChange(files.filter((item) => item.id !== id))} onOpen={onOpenFile} />)}{rootExpanded && visibleFolders.filter((folder) => !folder.parentId).map((folder) => <FolderRow expanded={expanded} files={visibleFiles} folder={folder} folders={visibleFolders} key={folder.id} onCreateFolder={createFolder} onDeleteFile={(id) => onFilesChange(files.filter((item) => item.id !== id))} onDeleteFolder={deleteFolder} onOpenFile={onOpenFile} onSelect={setSelectedId} onToggle={toggle} selectedId={selectedId} />)}</nav></aside>;
}

function descendantsOf(id: string, folders: ProjectFolder[]) {
  const ids = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) { ids.add(folder.id); changed = true; }
  }
  return ids;
}

function hasMatchingDescendant(id: string, folders: ProjectFolder[], files: ProjectFile[]): boolean {
  if (files.some((file) => file.folderId === id)) return true;
  return folders.filter((folder) => folder.parentId === id).some((folder) => hasMatchingDescendant(folder.id, folders, files));
}
