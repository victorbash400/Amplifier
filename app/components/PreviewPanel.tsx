"use client";

import type { ProjectFile } from "../types/workspace";
import { ViewerMonitor } from "./ViewerMonitor";
import type { TimelinePreviewState } from "./timelineTypes";
import styles from "./PreviewPanel.module.css";

export function PreviewPanel({ selectedFile, selectedFileStart, timeline }: { selectedFile?: ProjectFile; selectedFileStart: number; timeline: TimelinePreviewState }) {
  return <section className={styles.preview} aria-label="Viewers"><ViewerMonitor asset={selectedFile} key={selectedFile ? `${selectedFile.id}:${selectedFileStart}` : "empty-preview"} sourceStart={selectedFileStart} title="Preview" /><ViewerMonitor asset={timeline.asset} key={`timeline-${timeline.asset?.id || "empty"}`} timeline={timeline} title="Timeline" /></section>;
}
