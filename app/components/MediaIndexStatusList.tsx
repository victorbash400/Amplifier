import type { MediaAssetState } from "../lib/mediaSearch";
import type { ProjectFile } from "../types/workspace";
import { FileTypeIcon } from "./FileTypeIcon";
import styles from "./MediaSearchPanel.module.css";

type MediaIndexStatusListProps = {
  checking: boolean;
  files: ProjectFile[];
  onRetry: (assetId: string) => void;
  states: Record<string, MediaAssetState>;
};

export function MediaIndexStatusList({ checking, files, onRetry, states }: MediaIndexStatusListProps) {
  return <ol aria-label="Media indexing status" className={styles.indexList}>{files.map((file) => {
    const state = states[file.id];
    const status = state?.status || "missing";
    const progress = state?.progress;
    const detail = status === "ready" ? indexedAt(state?.updatedAt) : state?.stage || label(status);
    return <li data-status={status} key={file.id}><span className={styles.indexFile}><FileTypeIcon name={file.name} type={file.type} /><span>{file.name}</span>{status === "indexing" && <progress aria-label={`${file.name} indexing progress`} max="100" value={progress} />}</span><span className={styles.indexAction}><small>{checking ? "Checking" : detail}{progress !== undefined && status === "indexing" ? ` · ${progress}%` : ""}</small>{!checking && status === "failed" && <button onClick={() => onRetry(file.id)} type="button">Retry</button>}</span></li>;
  })}</ol>;
}

function indexedAt(value?: string) {
  if (!value) return "Indexed";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Indexed";
  const today = new Date();
  const time = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date);
  return date.toDateString() === today.toDateString() ? `Today at ${time}` : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function label(status: MediaAssetState["status"]) {
  if (status === "missing") return "Queued";
  if (status === "ready") return "Ready";
  if (status === "failed") return "Failed";
  return "Indexing";
}
