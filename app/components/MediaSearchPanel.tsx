import Image from "next/image";
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
  onRetry: (assetId: string) => void;
  onRetrySkipped: () => void;
  onSkipFailed: () => void;
  query: string;
  ready: number;
  results: MediaSearchResult[];
  searching: boolean;
  skipped: number;
  states: Record<string, MediaAssetState>;
  total: number;
};

export function MediaSearchPanel({ checking, error, failed, files, indexing, onOpen, onRetry, onRetrySkipped, onSkipFailed, query, ready, results, searching, skipped, states, total }: MediaSearchPanelProps) {
  const cleanQuery = query.trim();
  const queued = Math.max(total - ready - indexing - failed.length - skipped, 0);
  const progress = [ready && `${ready} ready`, indexing && `${indexing} indexing`, queued && `${queued} queued`, skipped && `${skipped} skipped`].filter(Boolean).join(" · ");
  const searchableFiles = files.filter((file) => !file.pending && file.objectKey && /^(video|audio|image)\//.test(file.type));
  const isChecking = checking || (searchableFiles.length > 0 && searchableFiles.every((file) => states[file.id]?.stage === "Checking"));

  let content;
  if (searching) content = <ol aria-label="Searching" className={styles.skeletons}><li /><li /><li /></ol>;
  else if (cleanQuery.length >= 2) content = results.length
    ? <ol className={styles.results}>{results.map((result) => <MediaSearchResultRow file={files.find((file) => file.id === result.assetId)} key={result.momentId} onOpen={onOpen} result={result} />)}</ol>
    : <p className={styles.empty}>No matching moments</p>;
  else if (total) content = <section className={styles.indexState}><header><Image alt="" height={25} src="/accessible-media-icons/search-document-svgrepo-com.svg" width={25} /><span><strong>Search moments in your media</strong><small>Indexing status</small></span></header><MediaIndexStatusList checking={isChecking} files={searchableFiles} onRetry={onRetry} states={states} /></section>;
  else content = <section className={styles.prompt}><Image alt="" height={30} src="/accessible-media-icons/search-document-svgrepo-com.svg" width={30} /><strong>Search moments in your media</strong><span>Recall anything with a few words</span></section>;

  return <section aria-busy={isChecking || searching || indexing > 0} aria-label="Media search results" className={styles.panel}>
    {content}
    <footer aria-live="polite">
      {isChecking ? <span>Checking existing index</span> : total > 0 && <span title={error}>{ready === total ? `${total} ${total === 1 ? "file" : "files"} searchable` : progress}</span>}
      {!isChecking && failed.length > 0 && <span className={styles.error} title={failed.map((file) => `${file.name}: ${file.error || "Indexing failed"}`).join("\n")}>{failed.length} failed</span>}
      {!total && <span>Add video, audio, or images to search inside them</span>}
      {!isChecking && failed.length > 0 && <button onClick={() => failed.forEach((file) => onRetry(file.id))} type="button">Retry all</button>}
      {!isChecking && failed.length > 0 && <button onClick={onSkipFailed} type="button">Skip</button>}
      {!isChecking && skipped > 0 && <button onClick={onRetrySkipped} type="button">Retry skipped</button>}
    </footer>
  </section>;
}
