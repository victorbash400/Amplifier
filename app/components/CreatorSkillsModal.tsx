"use client";

import Image from "next/image";
import { Check, FilePenLine, FileUp, Plus, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ChatSkillsContext, SkillDetail } from "../lib/skills";
import { CreatorSkillEditor } from "./CreatorSkillEditor";
import styles from "./CreatorSkillsModal.module.css";

type EditorState = { skillId?: string; initialContent?: string };

export function CreatorSkillsModal({ context, disabled, error, loading, onClose, onSaved, onSelectedChange }: { context?: ChatSkillsContext; disabled: boolean; error?: string; loading: boolean; onClose: () => void; onSaved: (skill: SkillDetail) => void; onSelectedChange: (ids: string[]) => void }) {
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<EditorState>();
  const [importError, setImportError] = useState<string>();
  const fileRef = useRef<HTMLInputElement>(null);
  const skills = useMemo(() => {
    const value = query.trim().toLowerCase();
    return value ? (context?.available_skills || []).filter((skill) => `${skill.name} ${skill.description}`.toLowerCase().includes(value)) : context?.available_skills || [];
  }, [context, query]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (editor) setEditor(undefined);
      else onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [editor, onClose]);

  async function importFile(file?: File) {
    if (!file) return;
    setImportError(undefined);
    try {
      const content = await file.text();
      if (!content.trim()) throw new Error("The imported skill is empty");
      setEditor({ initialContent: content });
    } catch (reason) {
      setImportError(reason instanceof Error ? reason.message : "Could not import skill");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function toggle(skillId: string) {
    const selected = context?.selected_skill_ids || [];
    onSelectedChange(selected.includes(skillId) ? selected.filter((id) => id !== skillId) : [...selected, skillId]);
  }

  function saved(skill: SkillDetail) {
    setEditor(undefined);
    onSaved(skill);
  }

  return createPortal(<aside aria-label="Skills" className={styles.overlay} onClick={onClose}><section aria-modal="true" className={styles.modal} data-editor={Boolean(editor)} onClick={(event) => event.stopPropagation()} role="dialog">{editor ? <CreatorSkillEditor initialContent={editor.initialContent} onBack={() => setEditor(undefined)} onSaved={saved} skillId={editor.skillId} /> : <><header><span><Image alt="" height={22} src="/accessible-media-icons/scroll-svgrepo-com%20(1).svg" width={22} /><h2>Skills</h2></span><nav><button disabled={disabled} onClick={() => setEditor({})} type="button"><Plus size={14} />New skill</button><button disabled={disabled} onClick={() => fileRef.current?.click()} type="button"><FileUp size={14} />Import</button><button aria-label="Close skills" onClick={onClose} type="button"><X size={15} /></button></nav></header><input accept=".md,.txt,text/markdown,text/plain" aria-label="Import skill file" hidden onChange={(event) => void importFile(event.target.files?.[0])} ref={fileRef} type="file" /><label className={styles.search}><Search size={15} /><input aria-label="Search skills" onChange={(event) => setQuery(event.target.value)} placeholder="Search skills" type="search" value={query} /></label>{loading ? <p className={styles.status}>Loading skills</p> : error || importError ? <p className={`${styles.status} ${styles.error}`}>{importError || error}</p> : skills.length ? <div className={styles.list}>{skills.map((skill) => { const selected = context?.selected_skill_ids.includes(skill.id) || false; return <article data-selected={selected} key={skill.id}><button className={styles.select} disabled={disabled} onClick={() => toggle(skill.id)} type="button"><Image alt="" height={18} src="/accessible-media-icons/scroll-svgrepo-com%20(1).svg" width={18} /><span><strong>{skill.name}</strong><small>{skill.description}</small></span><i>{selected ? <Check size={14} /> : skill.source}</i></button>{skill.editable && <button aria-label={`Edit ${skill.name}`} className={styles.edit} disabled={disabled} onClick={() => setEditor({ skillId: skill.id })} type="button"><FilePenLine size={14} /></button>}</article>; })}</div> : <p className={styles.status}>No matching skills</p>}</>}</section></aside>, document.body);
}
