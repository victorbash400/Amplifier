import Image from "next/image";
import type { MediaSearchResult } from "../lib/mediaSearch";
import type { ProjectFile } from "../types/workspace";
import styles from "./MediaSearchPanel.module.css";

export function MediaSearchResultRow({ file, onOpen, result }: { file?: ProjectFile; onOpen: (file: ProjectFile, start?: number) => void; result: MediaSearchResult }) {
  const timed = !result.contentType.startsWith("image/") && result.end > result.start;
  const thumbnailUrl = `/api/assets/media?projectId=${encodeURIComponent(file?.projectId || "")}&objectKey=${encodeURIComponent(result.thumbnailKey)}`;
  const evidence = [result.description, result.transcript].filter(Boolean).join(" · ");
  return <li className={styles.result}><button disabled={!file} onClick={() => file && onOpen(file, timed ? result.start : undefined)} type="button"><span className={styles.thumbnail}>{file && <Image alt="" fill sizes="58px" src={thumbnailUrl} unoptimized />}</span><span className={styles.copy}><strong>{result.assetName}</strong><span>{evidence}</span></span><small>{timed ? formatRange(result.start, result.end) : `${Math.round(result.score * 100)}%`}</small></button></li>;
}

function formatRange(start: number, end: number) {
  return `${formatTime(start)}–${formatTime(end)}`;
}

function formatTime(value: number) {
  const seconds = Math.max(0, Math.floor(value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
