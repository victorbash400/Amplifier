"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import styles from "./FileSidebar.module.css";

export function AssetRenameInput({ icon, label, maxLength, name, onCancel, onRename }: { icon: ReactNode; label: string; maxLength: number; name: string; onCancel: () => void; onRename: (name: string) => void }) {
  const [value, setValue] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.select(); }, []);

  function submit() {
    const next = value.trim();
    if (!next || next === name) onCancel(); else onRename(next);
  }

  return <label className={styles.renameInput}>{icon}<input aria-label={label} maxLength={maxLength} onBlur={submit} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") onCancel(); }} ref={inputRef} value={value} /></label>;
}
