import { X } from "lucide-react";
import type { SkillSummary } from "../lib/skills";
import styles from "./CreatorSkillAttachments.module.css";

export function CreatorSkillAttachments({ disabled, onRemove, skills }: { disabled: boolean; onRemove: (id: string) => void; skills: SkillSummary[] }) {
  if (!skills.length) return null;
  return <section aria-label="Attached skills" className={styles.skills}>{skills.map((skill) => <span key={skill.id}><i>/</i>{skill.name}<button aria-label={`Remove ${skill.name}`} disabled={disabled} onClick={() => onRemove(skill.id)} type="button"><X size={11} /></button></span>)}</section>;
}
