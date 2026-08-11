import { ChevronDown, FileText, Video } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./TimelineAslSourcePicker.module.css";

export type AslSource = "captions" | "description";

export function TimelineAslSourcePicker({ disabled, onSelect, working }: { disabled: boolean; onSelect: (source: AslSource) => void; working: boolean }) {
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => { if (!button.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false); };
    const closeKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeKey);
    return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", closeKey); };
  }, [open]);

  function toggle() {
    if (!open && button.current) {
      const rect = button.current.getBoundingClientRect();
      setPosition({ left: Math.min(window.innerWidth - 162, Math.max(8, rect.left)), top: rect.bottom + 6 });
    }
    setOpen((current) => !current);
  }

  function select(source: AslSource) { setOpen(false); onSelect(source); }

  return <><button aria-expanded={open} aria-haspopup="menu" aria-label="ASL interpretation" aria-pressed={working || undefined} className={styles.trigger} disabled={disabled} onClick={toggle} ref={button} title={disabled ? "Select a video clip to use ASL interpretation" : "ASL interpretation"} type="button"><Image alt="" height={15} src="/accessible-media-icons/sign-language-interpretation-svgrepo-com.svg" width={15} /><span>ASL</span><ChevronDown className={styles.chevron} size={8} /></button>{open && createPortal(<section aria-label="Generate ASL from" className={styles.menu} ref={menu} role="menu" style={position}><strong>Generate from</strong><button onClick={() => select("captions")} role="menuitem" type="button"><FileText size={14} /><span>Captions</span></button><button onClick={() => select("description")} role="menuitem" type="button"><Video size={14} /><span>Video description</span></button></section>, document.body)}</>;
}
