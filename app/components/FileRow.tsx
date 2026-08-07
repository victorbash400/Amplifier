"use client";

import { LoaderCircle, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import type { ProjectFile } from "../types/workspace";
import { AssetRenameInput } from "./AssetRenameInput";
import { FileTypeIcon } from "./FileTypeIcon";
import styles from "./FileSidebar.module.css";

export function FileRow({ file, onDelete, onOpen, onRename }: { file: ProjectFile; onDelete: (file: ProjectFile) => void; onOpen: (file: ProjectFile) => void; onRename: (file: ProjectFile, name: string) => void }) {
  const [renaming, setRenaming] = useState(false);
  return <p className={styles.fileRow}>{renaming ? <AssetRenameInput icon={<FileTypeIcon name={file.name} type={file.type} />} label={`Rename ${file.name}`} maxLength={255} name={file.name} onCancel={() => setRenaming(false)} onRename={(name) => { setRenaming(false); onRename(file, name); }} /> : <button className={styles.fileName} draggable={!file.pending} onClick={() => onOpen(file)} onDoubleClick={() => setRenaming(true)} onDragStart={(event) => { event.dataTransfer.effectAllowed = "copy"; event.dataTransfer.setData("application/x-amplifier-asset", file.id); event.dataTransfer.setData("text/plain", file.id); }} type="button"><span><FileTypeIcon name={file.name} type={file.type} /></span><span>{file.name}</span>{file.pending && <LoaderCircle aria-label="Uploading" className={styles.pending} size={12} />}</button>}<small>{formatBytes(file.size)}</small><button aria-label={`Rename ${file.name}`} className={styles.rowAction} disabled={file.pending} onClick={() => setRenaming(true)} title="Rename file" type="button"><Pencil size={12} /></button><button aria-label={`Delete ${file.name}`} className={styles.rowAction} disabled={file.pending} onClick={() => onDelete(file)} type="button"><Trash2 size={13} /></button></p>;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
