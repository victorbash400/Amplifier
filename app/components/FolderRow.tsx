"use client";

import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import type { ProjectFile, ProjectFolder } from "../types/workspace";
import { FileRow } from "./FileRow";
import { FolderIcon } from "./icons/FolderIcon";
import styles from "./FileSidebar.module.css";

type FolderRowProps = {
  folder: ProjectFolder;
  folders: ProjectFolder[];
  files: ProjectFile[];
  expanded: Set<string>;
  selectedId: string;
  onCreateFolder: (parentId: string) => void;
  onDeleteFile: (file: ProjectFile) => void;
  onDeleteFolder: (id: string) => void;
  onOpenFile: (file: ProjectFile) => void;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
};

export function FolderRow(props: FolderRowProps) {
  const { folder, folders, files, expanded, selectedId, onCreateFolder, onDeleteFile, onDeleteFolder, onOpenFile, onSelect, onToggle } = props;
  const children = folders.filter((item) => item.parentId === folder.id);
  const ownFiles = files.filter((file) => file.folderId === folder.id);
  const isExpanded = expanded.has(folder.id);
  const hasContents = children.length > 0 || ownFiles.length > 0;

  return <section className={styles.branch}><p className={styles.folderRow} data-selected={selectedId === folder.id}>{hasContents ? <button aria-label={`${isExpanded ? "Collapse" : "Expand"} ${folder.name}`} className={styles.chevron} onClick={() => onToggle(folder.id)} type="button">{isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button> : <span className={styles.chevron} />}<button className={styles.folderName} onClick={() => onSelect(folder.id)} type="button"><FolderIcon color={folder.color} /><span>{folder.name}</span></button><button aria-label={`New folder in ${folder.name}`} className={styles.rowAction} onClick={() => onCreateFolder(folder.id)} type="button"><Plus size={14} /></button><button aria-label={`Delete ${folder.name}`} className={styles.rowAction} onClick={() => onDeleteFolder(folder.id)} type="button"><Trash2 size={13} /></button></p>{isExpanded && ownFiles.map((file) => <FileRow file={file} key={file.id} onDelete={onDeleteFile} onOpen={onOpenFile} />)}{isExpanded && children.map((child) => <FolderRow {...props} folder={child} key={child.id} />)}</section>;
}
