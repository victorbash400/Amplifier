import { Trash2 } from "lucide-react";
import type { ProjectFile } from "../types/workspace";
import { FileTypeIcon } from "./FileTypeIcon";
import styles from "./FileSidebar.module.css";

export function FileRow({ file, onDelete, onOpen }: { file: ProjectFile; onDelete: (id: string) => void; onOpen: (file: ProjectFile) => void }) {
  return <p className={styles.fileRow}><button className={styles.fileName} onClick={() => onOpen(file)} type="button"><span><FileTypeIcon name={file.name} type={file.type} /></span><span>{file.name}</span></button><small>{formatBytes(file.size)}</small><button aria-label={`Delete ${file.name}`} className={styles.rowAction} onClick={() => onDelete(file.id)} type="button"><Trash2 size={13} /></button></p>;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
