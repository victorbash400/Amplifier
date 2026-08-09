"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Plus, Search, Upload } from "lucide-react";
import { uploadProjectAsset } from "../lib/assetUploads";
import { useMediaSearch } from "../hooks/useMediaSearch";
import type { AmplifierProject, ProjectFile, ProjectFolder } from "../types/workspace";
import { FileRow } from "./FileRow";
import { FolderRow } from "./FolderRow";
import { FolderIcon, folderColors } from "./icons/FolderIcon";
import { MediaSearchPanel } from "./MediaSearchPanel";
import { MediaSearchToggle } from "./MediaSearchToggle";
import styles from "./FileSidebar.module.css";

type FileSidebarProps = {
  project: AmplifierProject;
  folders: ProjectFolder[];
  files: ProjectFile[];
  onFoldersChange: (folders: ProjectFolder[]) => void;
  onFilesChange: (files: ProjectFile[]) => void;
  onOpenFile: (file: ProjectFile, start?: number) => void;
};

export function FileSidebar({ project, folders, files, onFoldersChange, onFilesChange, onOpenFile }: FileSidebarProps) {
  const [fileQuery, setFileQuery] = useState("");
  const [mediaQuery, setMediaQuery] = useState("");
  const [mediaSearchActive, setMediaSearchActive] = useState(false);
  const [selectedId, setSelectedId] = useState("root");
  const [expanded, setExpanded] = useState(() => new Set(["root"]));
  const [uploadError, setUploadError] = useState<string>();
  const localUrls = useRef(new Set<string>());
  const mediaSearch = useMediaSearch(project.id, files, mediaSearchActive, mediaQuery);
  const normalizedQuery = fileQuery.trim().toLowerCase();
  const visibleFiles = useMemo(() => files.filter((file) => file.name.toLowerCase().includes(normalizedQuery)), [files, normalizedQuery]);
  const visibleFolders = useMemo(() => folders.filter((folder) => folder.name.toLowerCase().includes(normalizedQuery) || hasMatchingDescendant(folder.id, folders, visibleFiles)), [folders, normalizedQuery, visibleFiles]);

  useEffect(() => () => {
    for (const url of localUrls.current) URL.revokeObjectURL(url);
    localUrls.current.clear();
  }, []);

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

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files || []);
    if (!selectedFiles.length) return;
    event.target.value = "";
    setUploadError(undefined);
    setExpanded((current) => new Set(current).add(selectedId));
    const pending = selectedFiles.map((file) => {
      const localUrl = URL.createObjectURL(file);
      localUrls.current.add(localUrl);
      return { id: crypto.randomUUID(), file, localUrl };
    });
    let nextFiles: ProjectFile[] = [...files, ...pending.map(({ id, file, localUrl }) => ({ id, projectId: project.id, folderId: selectedId, name: file.name, size: file.size, type: file.type || "application/octet-stream", pending: true, localUrl }))];
    onFilesChange(nextFiles);
    const failures = await parallelMap(pending, 3, async ({ id, file, localUrl }) => {
      try {
        const uploaded = await uploadProjectAsset({ assetId: id, file, folderId: selectedId, localUrl, projectId: project.id, onProgress: () => undefined });
        nextFiles = nextFiles.map((item) => item.id === id ? uploaded : item);
        onFilesChange(nextFiles);
        URL.revokeObjectURL(localUrl);
        localUrls.current.delete(localUrl);
        return undefined;
      } catch (reason) {
        nextFiles = nextFiles.filter((item) => item.id !== id);
        onFilesChange(nextFiles);
        URL.revokeObjectURL(localUrl);
        localUrls.current.delete(localUrl);
        return `${file.name}: ${reason instanceof Error ? reason.message : "Upload failed"}`;
      }
    });
    const messages = failures.filter((failure): failure is string => Boolean(failure));
    if (messages.length) setUploadError(messages.join(" · "));
  }

  async function deleteFile(file: ProjectFile) {
    onFilesChange(files.filter((item) => item.id !== file.id));
    setUploadError(undefined);
    if (!file.objectKey) return;
    try {
      const response = await fetch("/api/assets/uploads", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: project.id, assetId: file.id, objectKey: file.objectKey }) });
      if (!response.ok) throw new Error((await response.json()).error || `Could not delete ${file.name}`);
      if (file.localUrl) {
        URL.revokeObjectURL(file.localUrl);
        localUrls.current.delete(file.localUrl);
      }
    } catch (reason) {
      onFilesChange(files);
      setUploadError(reason instanceof Error ? reason.message : `Could not delete ${file.name}`);
    }
  }

  function renameFile(file: ProjectFile, name: string) {
    onFilesChange(files.map((item) => item.id === file.id ? { ...item, name } : item));
  }

  function renameFolder(id: string, name: string) {
    onFoldersChange(folders.map((folder) => folder.id === id ? { ...folder, name } : folder));
  }

  const rootExpanded = expanded.has("root");
  return <aside className={styles.sidebar} aria-label="Assets"><section className={styles.search}><Search aria-hidden="true" size={17} strokeWidth={1.7} /><input aria-label={mediaSearchActive ? "Search moments" : "Search assets"} onChange={(event) => mediaSearchActive ? setMediaQuery(event.target.value) : setFileQuery(event.target.value)} placeholder={mediaSearchActive ? "Search moments" : "Search assets"} type="search" value={mediaSearchActive ? mediaQuery : fileQuery} /><MediaSearchToggle active={mediaSearchActive} onToggle={() => setMediaSearchActive((current) => !current)} /></section>{!mediaSearchActive && <nav className={styles.actions} aria-label="Asset actions"><label aria-label="Upload files" title="Upload files"><Upload size={16} /><input multiple onChange={upload} type="file" /></label><button aria-label="New folder" onClick={() => createFolder()} title="New folder" type="button"><Plus size={16} /></button></nav>}{uploadError && <p className={styles.uploadError} role="alert">{uploadError}</p>}{mediaSearchActive ? <MediaSearchPanel error={mediaSearch.error} failed={mediaSearch.failed} files={files} indexing={mediaSearch.indexingCount} onOpen={onOpenFile} onRefresh={mediaSearch.refreshStatus} onRetry={mediaSearch.retry} onRetrySkipped={mediaSearch.retrySkipped} onSkipFailed={mediaSearch.skipFailed} query={mediaQuery} ready={mediaSearch.ready} refreshing={mediaSearch.refreshing} results={mediaSearch.results} searching={mediaSearch.searching} skipped={mediaSearch.skippedCount} states={mediaSearch.states} total={mediaSearch.total} /> : <nav className={styles.tree} aria-label="Asset tree"><p className={styles.folderRow} data-selected={selectedId === "root"}><button aria-label={`${rootExpanded ? "Collapse" : "Expand"} ${project.name}`} className={styles.chevron} onClick={() => toggle("root")} type="button">{rootExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button><button className={styles.folderName} onClick={() => setSelectedId("root")} type="button"><FolderIcon color={project.color} open={rootExpanded} /><strong>{project.name}</strong></button><button aria-label="New folder in project" className={styles.rowAction} onClick={() => createFolder("root")} title="New folder" type="button"><Plus size={15} /></button></p>{rootExpanded && visibleFiles.filter((file) => file.folderId === "root").map((file) => <FileRow file={file} key={file.id} onDelete={deleteFile} onOpen={onOpenFile} onRename={renameFile} />)}{rootExpanded && visibleFolders.filter((folder) => !folder.parentId).map((folder) => <FolderRow expanded={expanded} files={visibleFiles} folder={folder} folders={visibleFolders} key={folder.id} onCreateFolder={createFolder} onDeleteFile={deleteFile} onDeleteFolder={deleteFolder} onOpenFile={onOpenFile} onRenameFile={renameFile} onRenameFolder={renameFolder} onSelect={setSelectedId} onToggle={toggle} selectedId={selectedId} />)}</nav>}</aside>;
}

async function parallelMap<T, R>(items: T[], concurrency: number, task: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
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
