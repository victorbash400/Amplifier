import { Volume2 } from "lucide-react";
import styles from "./TimelinePanel.module.css";

export function TimelineClipVolumeControl({ name, onChange, value }: { name: string; onChange: (value: number) => void; value: number }) {
  return <label className={styles.clipVolume}><Volume2 size={13} /><span>Audio</span><input aria-label={`${name} audio level`} max="1" min="0" onChange={(event) => onChange(Number(event.target.value))} step="0.01" type="range" value={value} /><small>{Math.round(value * 100)}%</small></label>;
}
