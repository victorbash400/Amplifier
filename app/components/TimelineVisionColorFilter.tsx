import { Check, ChevronDown, Palette } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { VisionColorPreset } from "./TimelineAccessibilityTools";
import styles from "./TimelinePanel.module.css";

export function TimelineVisionColorFilter({ disabled, onApply, value }: { disabled: boolean; onApply: (preset?: VisionColorPreset) => void; value?: VisionColorPreset }) {
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const options: Array<{ label: string; shortLabel: string; value?: VisionColorPreset }> = [{ label: "Original colours", shortLabel: "Colour safe" }, { label: "Red-green separation", shortLabel: "Red-green", value: "red-green" }, { label: "Blue-yellow separation", shortLabel: "Blue-yellow", value: "blue-yellow" }, { label: "All-colour separation", shortLabel: "All colours", value: "all-channels" }];
  const selected = options.find((option) => option.value === value) || options[0];

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => { if (!button.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false); };
    const closeKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    const closeResize = () => setOpen(false);
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeKey);
    window.addEventListener("resize", closeResize);
    return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", closeKey); window.removeEventListener("resize", closeResize); };
  }, [open]);

  function toggle() {
    if (!open && button.current) {
      const rect = button.current.getBoundingClientRect();
      setPosition({ left: Math.min(window.innerWidth - 190, Math.max(8, rect.left)), top: rect.bottom + 6 });
    }
    setOpen((current) => !current);
  }

  function choose(preset?: VisionColorPreset) { onApply(preset); setOpen(false); }

  return <><button aria-expanded={open} aria-haspopup="listbox" aria-label="Colour-safe visual filter" className={styles.colorFilter} disabled={disabled} onClick={toggle} ref={button} title={disabled ? "Select a visual clip to use colour-safe visuals" : selected.label} type="button"><Palette size={14} /><span>{selected.shortLabel}</span><ChevronDown size={10} /></button>{open && createPortal(<section aria-label="Colour-safe visual filters" className={styles.colorPickerMenu} ref={menu} role="listbox" style={position}>{options.map((option) => <button aria-selected={option.value === value} key={option.label} onClick={() => choose(option.value)} role="option" type="button"><span>{option.label}</span>{option.value === value && <Check size={13} />}</button>)}</section>, document.body)}</>;
}
