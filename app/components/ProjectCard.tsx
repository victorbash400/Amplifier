import { Trash2 } from "lucide-react";
import type { AmplifierProject } from "../types/workspace";
import { FolderIcon } from "./icons/FolderIcon";
import styles from "./ProjectList.module.css";

export function ProjectCard({ project, onDelete, onOpen }: { project: AmplifierProject; onDelete: (id: string) => void; onOpen: (id: string) => void }) {
  return <article className={styles.card}><button aria-label={`Open ${project.name}`} className={styles.open} onClick={() => onOpen(project.id)} type="button"><FolderIcon color={project.color} size="project" /><span>{project.name}</span></button><button aria-label={`Delete ${project.name}`} className={styles.delete} onClick={() => onDelete(project.id)} type="button"><Trash2 size={14} /></button></article>;
}
