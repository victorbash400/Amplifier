import { Contrast, X } from "lucide-react";
import { useState } from "react";
import styles from "./TimelinePanel.module.css";

export function TimelineVisionContrastControl({ disabled, onChange, value }: { disabled: boolean; onChange: (value: number) => void; value: number }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button aria-label="Higher contrast" disabled={disabled} onClick={() => setOpen(true)} title={disabled ? "Select a visual clip to adjust contrast" : "Adjust contrast"} type="button"><Contrast size={15} /><span>Contrast</span></button>;
  return <section className={styles.contrastControl}><Contrast size={14} /><input aria-label="Clip contrast" disabled={disabled} max="2" min="0.75" onChange={(event) => onChange(Number(event.target.value))} step="0.05" type="range" value={value} /><output>{value.toFixed(1)}×</output><button aria-label="Close contrast control" onClick={() => setOpen(false)} type="button"><X size={11} /></button></section>;
}
