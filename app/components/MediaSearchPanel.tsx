import Image from "next/image";
import { RefreshCw } from "lucide-react";
import type { MediaAssetState, MediaSearchResult } from "../lib/mediaSearch";
import type { ProjectFile } from "../types/workspace";
import { MediaSearchResultRow } from "./MediaSearchResultRow";
import { MediaIndexStatusList } from "./MediaIndexStatusList";
import styles from "./MediaSearchPanel.module.css";

type MediaSearchPanelProps = {
  checking?: boolean;
  error?: string;
  failed: Array<{ id: string; name: string; error?: string }>;
  files: ProjectFile[];
  indexing: number;
  onOpen: (file: ProjectFile, start?: number) => void;
  onRefresh: () => void;
  onRetry: (assetId: string) => void;
  onRetrySkipped: () => void;
  onSkipFailed: () => void;
  query: string;
  ready: number;
  refreshing: boolean;
  results: MediaSearchResult[];
  searching: boolean;
  skipped: number;
  states: Record<string, MediaAssetState>;
  total: number;
};

export function MediaSearchPanel({ checking, error, failed, files, indexing, onOpen, onRefresh, onRetry, onRetrySkipped, onSkipFailed, query, ready, refreshing, results, searching, skipped, states, total }: MediaSearchPanelProps) {
  const cleanQuery = query.trim();
  const searchableFiles = files.filter((file) => !file.pending && file.objectKey && /^(video|audio|image)\//.test(file.type));
  const isChecking = checking || (searchableFiles.length > 0 && searchableFiles.every((file) => states[file.id]?.stage === "Checking"));

  let content;
  if (cleanQuery.length < 2 && total) content = <section className={styles.indexState}><MediaIndexStatusList checking={isChecking} files={searchableFiles} onRetry={onRetry} states={states} /></section>;
  else if (cleanQuery.length < 2) content = <section className={styles.prompt}><Image alt="" height={30} src="/accessible-media-icons/search-document-svgrepo-com.svg" width={30} /><strong>Search moments in your media</strong><span>Recall anything with a few words</span></section>;
  else if (searching) content = <ol aria-label="Searching" className={styles.skeletons}><li /><li /><li /></ol>;
  else if (results.length) content = <ol className={styles.results}>{results.map((result) => <MediaSearchResultRow file={files.find((file) => file.id === result.assetId)} key={result.momentId} onOpen={onOpen} result={result} />)}</ol>;
  else content = <p className={styles.empty}>No matching moments</p>;

  return <section aria-busy={isChecking || searching || indexing > 0} aria-label="Media search results" className={styles.panel}>
    {content}
    <footer aria-live="polite">
      {isChecking ? <span>Checking existing index</span> : total > 0 && <span title={error}>{ready === total ? `${total} ${total === 1 ? "file" : "files"} searchable` : "Preparing media search"}</span>}
      {!isChecking && failed.length > 0 && <span className={styles.error} title={failed.map((file) => `${file.name}: ${file.error || "Indexing failed"}`).join("\n")}>{failed.length} failed</span>}
      {!total && <span>Add video, audio, or images to search inside them</span>}
      {!isChecking && failed.length > 0 && <button onClick={() => failed.forEach((file) => onRetry(file.id))} type="button">Retry all</button>}
      {!isChecking && failed.length > 0 && <button onClick={onSkipFailed} type="button">Skip</button>}
      {!isChecking && skipped > 0 && <button onClick={onRetrySkipped} type="button">Retry skipped</button>}
      {total > 0 && <button aria-label="Refresh indexing status" className={styles.refreshButton} disabled={refreshing} onClick={onRefresh} title="Refresh status" type="button"><RefreshCw className={refreshing ? styles.refreshing : undefined} size={14} /></button>}
    </footer>
  </section>;
}
