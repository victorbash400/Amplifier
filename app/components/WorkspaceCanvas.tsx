import { FileText } from "lucide-react";
import type { AmplifierProject, ProjectFile } from "../types/workspace";
import styles from "./WorkspaceCanvas.module.css";

export function WorkspaceCanvas({ project, selectedFile }: { project: AmplifierProject; selectedFile?: ProjectFile }) {
  return <section className={styles.preview} aria-label={`${project.name} preview`}>{selectedFile && <p className={styles.selection}><FileText size={16} /><span>{selectedFile.name}</span></p>}</section>;
}
