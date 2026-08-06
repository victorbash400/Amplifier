import { Volume2, VolumeX } from "lucide-react";
import styles from "./ViewerMonitor.module.css";

export function ViewerVolumeControl({ muted, volume, onMutedChange, onVolumeChange }: { muted: boolean; volume: number; onMutedChange: (muted: boolean) => void; onVolumeChange: (volume: number) => void }) {
  return <span className={styles.volumeControl}><button aria-label={muted ? "Unmute" : "Mute"} onClick={() => onMutedChange(!muted)} type="button">{muted || volume === 0 ? <VolumeX size={13} /> : <Volume2 size={13} />}</button><input aria-label="Volume" max="1" min="0" onChange={(event) => onVolumeChange(Number(event.target.value))} step="0.01" type="range" value={muted ? 0 : volume} /></span>;
}
