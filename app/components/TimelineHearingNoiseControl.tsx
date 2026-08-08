import { Check, Volume1, X } from "lucide-react";
import { useState } from "react";
import styles from "./TimelinePanel.module.css";

export function TimelineHearingNoiseControl({ disabled, onApply, value }: { disabled: boolean; onApply: (value: number) => void; value: number }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  if (!open) return <button aria-label="Reduced background noise" disabled={disabled} onClick={() => { setDraft(value); setOpen(true); }} title={disabled ? "Select a clip with audio to reduce noise" : "Reduce background noise"} type="button"><Volume1 size={15} /><span>Noise reduce</span></button>;
  return <section className={styles.noiseControl}><Volume1 size={14} /><input aria-label="Noise reduction strength" disabled={disabled} max="1" min="0" onChange={(event) => setDraft(Number(event.target.value))} step="0.05" type="range" value={draft} /><output>{Math.round(draft * 100)}%</output><button aria-label="Apply noise reduction" disabled={disabled} onClick={() => { onApply(draft); setOpen(false); }} type="button"><Check size={11} /></button><button aria-label="Close noise reduction" onClick={() => setOpen(false)} type="button"><X size={11} /></button></section>;
}
