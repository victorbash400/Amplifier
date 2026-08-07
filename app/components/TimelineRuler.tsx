import styles from "./TimelinePanel.module.css";

export function TimelineRuler({ duration, scale }: { duration: number; scale: number }) {
  return <ol aria-label="Timeline ruler" className={styles.ruler}>{stops(duration, scale).map((stop) => <li key={stop} style={{ left: `${(stop / duration) * 100}%` }}>{formatTimecode(stop)}</li>)}</ol>;
}

export function formatTimecode(value: number) {
  const frames = Math.floor((value % 1) * 30).toString().padStart(2, "0");
  const seconds = Math.floor(value % 60).toString().padStart(2, "0");
  const minutes = Math.floor(value / 60 % 60).toString().padStart(2, "0");
  const hours = Math.floor(value / 3600).toString().padStart(2, "0");
  return `${hours}:${minutes}:${seconds}:${frames}`;
}

function stops(duration: number, scale: number) {
  const step = scale >= 5 ? 2 : scale >= 2 ? 5 : 10;
  return Array.from({ length: Math.floor(duration / step) + 1 }, (_, index) => index * step);
}
