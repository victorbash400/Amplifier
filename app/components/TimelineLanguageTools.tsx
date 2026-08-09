"use client";

import { AudioLines, Captions, FileAudio } from "lucide-react";
import { useState } from "react";
import { TimelineLanguagePicker, timelineLanguages } from "./TimelineLanguagePicker";
import styles from "./TimelinePanel.module.css";

export type LanguageAction = "captions" | "audio" | "descriptions";

export function TimelineLanguageTools({ clipSelected, onAction, working }: { clipSelected: boolean; onAction: (action: LanguageAction, language: string) => void; working?: LanguageAction }) {
  const [language, setLanguage] = useState("es");
  const name = timelineLanguages.find((item) => item.code === language)?.name ?? language;
  const title = clipSelected ? undefined : "Select a clip to translate";
  return (
    <nav aria-label="Language tools" className={`${styles.accessibilityTools} ${styles.languageTools}`}>
      <TimelineLanguagePicker disabled={!clipSelected || Boolean(working)} onChange={setLanguage} value={language} />
      <button aria-label={`Translate captions to ${name}`} aria-pressed={working === "captions" || undefined} disabled={!clipSelected || Boolean(working)} onClick={() => onAction("captions", language)} title={title} type="button"><Captions size={15} /><span>Captions</span></button>
      <button aria-label={`Translate spoken audio to ${name}`} aria-pressed={working === "audio" || undefined} disabled={!clipSelected || Boolean(working)} onClick={() => onAction("audio", language)} title={title} type="button"><FileAudio size={15} /><span>Audio</span></button>
      <button aria-label={`Translate descriptions to ${name}`} aria-pressed={working === "descriptions" || undefined} disabled={!clipSelected || Boolean(working)} onClick={() => onAction("descriptions", language)} title={title} type="button"><AudioLines size={15} /><span>Descriptions</span></button>
    </nav>
  );
}
