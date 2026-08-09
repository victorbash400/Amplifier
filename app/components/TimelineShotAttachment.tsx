"use client";

import { X } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import type { TimelineShot } from "../lib/timelineShot";
import { TimelineShotViewer } from "./TimelineShotViewer";
import styles from "./TimelineShotAttachment.module.css";

export function TimelineShotAttachment({ onRemove, shot }: { onRemove?: () => void; shot: TimelineShot }) {
  const [open, setOpen] = useState(false);
  const issues = shot.diagnostics.overlaps.length + shot.diagnostics.brokenLinks.length + shot.diagnostics.outOfBoundsClipIds.length;
  return <><article className={styles.card} data-timeline-shot-card>
    <button aria-label="Open Timeline Shot" className={styles.preview} onClick={() => setOpen(true)} type="button"><Image alt="Captured timeline" height={72} priority src={shot.image} unoptimized width={76} /></button>
    <button className={styles.label} onClick={() => setOpen(true)} type="button"><strong>Timeline Shot</strong><span>{shot.clips.length} clips · {shot.tracks.length} tracks · {issues} issues</span></button>
    {onRemove && <button aria-label="Remove Timeline Shot" className={styles.remove} onClick={onRemove} type="button"><X size={14} /></button>}
  </article>{open && <TimelineShotViewer onClose={() => setOpen(false)} shot={shot} />}</>;
}
