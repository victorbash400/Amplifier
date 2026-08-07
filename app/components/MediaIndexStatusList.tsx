import type { MediaAssetState } from "../lib/mediaSearch";
import type { ProjectFile } from "../types/workspace";
import styles from "./MediaSearchPanel.module.css";

type MediaIndexStatusListProps = {
  checking: boolean;
  files: ProjectFile[];
  onRetry: (assetId: string) => void;
  states: Record<string, MediaAssetState>;
};

export function MediaIndexStatusList({ checking, files, onRetry, states }: MediaIndexStatusListProps) {
  return <ol aria-label="Media indexing status" className={styles.indexList}>{files.map((file) => {
    const status = states[file.id]?.status || "missing";
    return <li data-status={status} key={file.id}><span>{file.name}</span><span className={styles.indexAction}><small>{checking ? "Checking" : states[file.id]?.stage || label(status)}</small>{!checking && status === "failed" && <button onClick={() => onRetry(file.id)} type="button">Retry</button>}</span></li>;
  })}</ol>;
}

function label(status: MediaAssetState["status"]) {
  if (status === "missing") return "Queued";
  if (status === "ready") return "Ready";
  if (status === "failed") return "Failed";
  return "Indexing";
}
