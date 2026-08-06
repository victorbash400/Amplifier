"use client";

import type { ProjectFile } from "../types/workspace";
import { ViewerMonitor } from "./ViewerMonitor";
import type { TimelinePreviewState } from "./timelineTypes";
import styles from "./PreviewPanel.module.css";

export function PreviewPanel({ selectedFile, timeline }: { selectedFile?: ProjectFile; timeline: TimelinePreviewState }) {
  return <section className={styles.preview} aria-label="Viewers"><ViewerMonitor asset={selectedFile} key={selectedFile?.id || "empty-preview"} title="Preview" /><ViewerMonitor asset={timeline.asset} key={`timeline-${timeline.asset?.id || "empty"}`} timeline={timeline} title="Timeline" /></section>;
}
