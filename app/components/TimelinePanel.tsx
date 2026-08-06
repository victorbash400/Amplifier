import { Maximize2, Pause, Play, ZoomIn, ZoomOut } from "lucide-react";
import styles from "./TimelinePanel.module.css";

export function TimelinePanel() {
  return <section className={styles.timeline} aria-label="Timeline"><header><nav aria-label="Timeline tools"><button aria-label="Play" type="button"><Play size={15} /></button><button aria-label="Pause" type="button"><Pause size={15} /></button></nav><time>0:00</time><nav aria-label="Timeline view"><button aria-label="Zoom out" type="button"><ZoomOut size={15} /></button><button aria-label="Fit timeline" type="button"><Maximize2 size={15} /></button><button aria-label="Zoom in" type="button"><ZoomIn size={15} /></button></nav></header><section className={styles.composition}><p>Drag media here</p></section></section>;
}
