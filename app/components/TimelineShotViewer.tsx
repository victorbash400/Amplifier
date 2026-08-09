"use client";

import { X } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { createPortal } from "react-dom";
import type { TimelineShot } from "../lib/timelineShot";
import styles from "./TimelineShotViewer.module.css";

export function TimelineShotViewer({ onClose, shot }: { onClose: () => void; shot: TimelineShot }) {
  const [view, setView] = useState<"timeline" | "structure">("timeline");
  return createPortal(<section aria-label="Timeline Shot" aria-modal="true" className={styles.backdrop} role="dialog" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <article className={styles.viewer}><header><strong>Timeline Shot</strong><nav aria-label="Timeline Shot view"><button aria-pressed={view === "timeline"} onClick={() => setView("timeline")} type="button">Timeline</button><button aria-pressed={view === "structure"} onClick={() => setView("structure")} type="button">Structure</button></nav><button aria-label="Close Timeline Shot" onClick={onClose} type="button"><X size={16} /></button></header>
      {view === "timeline" ? <Image alt="Captured timeline" height={shot.imageHeight || 560} src={shot.image} unoptimized width={shot.imageWidth || 928} /> : <section className={styles.structure}><p><strong>Revision</strong><span>{shot.revision}</span></p><p><strong>Playhead</strong><span>{shot.view.playhead.toFixed(2)}s</span></p><p><strong>Tracks</strong><span>{shot.tracks.map((track) => `${track.role} ${track.lane + 1}`).join(", ")}</span></p><h3>Clips</h3>{shot.clips.map((clip) => <p key={clip.id}><strong>{clip.name}</strong><span>{clip.role} {clip.lane + 1} · {clip.start.toFixed(2)}–{clip.end.toFixed(2)}s</span></p>)}<h3>Diagnostics</h3><p><strong>Overlaps</strong><span>{shot.diagnostics.overlaps.length}</span></p><p><strong>Broken links</strong><span>{shot.diagnostics.brokenLinks.length}</span></p></section>}
    </article>
  </section>, document.body);
}
