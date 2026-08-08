import { Download, Maximize2, X } from "lucide-react";
import { useState } from "react";
import type { CaptionCue, CaptionKind } from "./timelineTypes";
import styles from "./ViewerCaptionOverlay.module.css";

export function ViewerCaptionOverlay({ cues, currentTime, downloadText, kind, large, onSeek }: { cues: CaptionCue[]; currentTime: number; downloadText?: string; kind: CaptionKind; large: boolean; onSeek: (time: number) => void }) {
  const [expanded, setExpanded] = useState(false);
  const active = cues.filter((cue) => cue.start <= currentTime + .18 && cue.end > currentTime + .18);
  const braille = kind === "braille";
  const title = braille ? "Braille transcript" : "Transcript";
  function download() {
    const text = braille ? downloadText || cues.map((cue) => `${cue.brfTime || `${clock(cue.start)}-${clock(cue.end)}`}\n${cue.brf || cue.text}`).join("\n\n") : cues.map((cue, index) => `${index + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${cue.text}`).join("\n\n");
    const url = URL.createObjectURL(new Blob([text], { type: braille ? "application/x-brf" : "application/x-subrip;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = braille ? "timeline-braille-transcript.brf" : "timeline-transcript.srt";
    anchor.click();
    URL.revokeObjectURL(url);
  }
  if (expanded) return <section aria-label={`Full ${title.toLowerCase()}`} className={styles.transcript}><header><strong>{title}</strong><button aria-label={`Download ${title.toLowerCase()}`} onClick={download} type="button"><Download size={13} /></button><button aria-label={`Close ${title.toLowerCase()}`} onClick={() => setExpanded(false)} type="button"><X size={14} /></button></header><ol>{cues.map((cue) => <li key={cue.id}><button onClick={() => onSeek(cue.start)} type="button"><time>{clock(cue.start)}</time><span>{cue.text}</span></button></li>)}</ol></section>;
  if (!active.length) return null;
  return <section aria-live="polite" className={styles.caption} data-large={large || undefined}><span>{active.map((cue) => cue.text).join(" ")}</span><button aria-label={`Open ${title.toLowerCase()}`} onClick={() => setExpanded(true)} type="button"><Maximize2 size={11} /></button></section>;
}

function clock(value: number) {
  const seconds = Math.max(0, Math.floor(value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function srtTime(value: number) {
  const milliseconds = Math.max(0, Math.round(value * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor(milliseconds % 3_600_000 / 60_000);
  const seconds = Math.floor(milliseconds % 60_000 / 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(milliseconds % 1000).padStart(3, "0")}`;
}
