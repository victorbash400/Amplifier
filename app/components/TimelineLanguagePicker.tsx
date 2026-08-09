"use client";

import { Check, ChevronDown } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import panelStyles from "./TimelinePanel.module.css";
import styles from "./TimelineLanguagePicker.module.css";

export const timelineLanguages = [{ code: "en", name: "English" }, { code: "es", name: "Spanish" }, { code: "fr", name: "French" }, { code: "de", name: "German" }, { code: "pt", name: "Portuguese" }, { code: "it", name: "Italian" }, { code: "ar", name: "Arabic" }, { code: "hi", name: "Hindi" }, { code: "ja", name: "Japanese" }, { code: "ko", name: "Korean" }, { code: "zh", name: "Chinese" }];

export function TimelineLanguagePicker({ disabled, onChange, value }: { disabled: boolean; onChange: (language: string) => void; value: string }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const modal = useRef<HTMLElement>(null);
  const options = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const selected = timelineLanguages.find((language) => language.code === value) ?? timelineLanguages[0];

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => { if (!trigger.current?.contains(event.target as Node) && !modal.current?.contains(event.target as Node)) setOpen(false); };
    const close = () => setOpen(false);
    const closeKey = (event: KeyboardEvent) => { if (event.key === "Escape") { close(); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", closeKey); window.removeEventListener("resize", close); window.removeEventListener("scroll", close, true); };
  }, [open]);

  function toggle() {
    if (!open && trigger.current) {
      const rect = trigger.current.getBoundingClientRect();
      setPosition({ left: Math.min(window.innerWidth - 228, Math.max(8, rect.left)), top: rect.bottom + 7 });
      requestAnimationFrame(() => options.current[timelineLanguages.findIndex((language) => language.code === value)]?.focus());
    }
    setOpen((current) => !current);
  }

  function select(language: string) {
    onChange(language);
    setOpen(false);
    trigger.current?.focus();
  }

  function move(event: React.KeyboardEvent, index: number) {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    const change = event.key === "ArrowDown" ? 1 : -1;
    options.current[(index + change + timelineLanguages.length) % timelineLanguages.length]?.focus();
  }

  return <><button aria-expanded={open} aria-haspopup="dialog" aria-label="Target language" className={`${panelStyles.languagePicker} ${styles.trigger}`} disabled={disabled} onClick={toggle} ref={trigger} type="button"><Image alt="" height={15} src="/accessible-media-icons/language-svgrepo-com.svg" width={15} /><span>{selected.name}</span><ChevronDown size={10} /></button>{open && createPortal(<section aria-label="Choose language" aria-modal="false" className={styles.modal} ref={modal} role="dialog" style={position}><header><strong>Language</strong><small>Choose translation language</small></header><div role="listbox">{timelineLanguages.map((language, index) => <button aria-selected={language.code === value} key={language.code} onClick={() => select(language.code)} onKeyDown={(event) => move(event, index)} ref={(element) => { options.current[index] = element; }} role="option" type="button"><span>{language.name}</span>{language.code === value && <Check size={13} />}</button>)}</div></section>, document.body)}</>;
}
