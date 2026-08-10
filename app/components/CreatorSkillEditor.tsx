"use client";

import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { createSkill, loadSkill, updateSkill, type SkillDetail } from "../lib/skills";
import styles from "./CreatorSkillEditor.module.css";

export function CreatorSkillEditor({ initialContent = "", onBack, onSaved, skillId }: { initialContent?: string; onBack: () => void; onSaved: (skill: SkillDetail) => void; skillId?: string }) {
  const [content, setContent] = useState(initialContent);
  const [savedContent, setSavedContent] = useState(initialContent);
  const [skill, setSkill] = useState<SkillDetail>();
  const [loading, setLoading] = useState(Boolean(skillId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!skillId) return;
    let active = true;
    void loadSkill(skillId).then((loaded) => { if (active) { setSkill(loaded); setContent(loaded.content); setSavedContent(loaded.content); } }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Could not open skill"); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [skillId]);

  async function save() {
    if (!content.trim() || loading || saving) return;
    setSaving(true);
    setError(undefined);
    try {
      const saved = skillId ? await updateSkill(skillId, content) : await createSkill(content);
      setSkill(saved);
      setContent(saved.content);
      setSavedContent(saved.content);
      onSaved(saved);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save skill");
    } finally {
      setSaving(false);
    }
  }

  const dirty = content !== savedContent;
  return <section className={styles.editor}><header><button aria-label="Back to skills" onClick={onBack} type="button"><ArrowLeft size={16} /></button><span><h2>{skill?.name || (skillId ? "Skill" : "New skill")}</h2><small>{skill?.description || "Markdown"}</small></span><button disabled={!content.trim() || loading || saving || (!dirty && Boolean(skill))} onClick={() => void save()} type="button">{saving ? "Saving" : "Save"}</button></header><p data-error={Boolean(error)}>{error || (loading ? "Opening" : dirty ? "Unsaved" : skill ? "Saved" : "Write the instructions Amplifier should follow")}</p><textarea aria-label="Skill instructions" autoFocus={!skillId} disabled={loading || saving} onChange={(event) => setContent(event.target.value)} placeholder={`# Skill name\n\nWrite the instructions the way you want Amplifier to follow them.`} spellCheck value={content} /></section>;
}
