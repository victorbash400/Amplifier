"use client";

import Image from "next/image";
import { AudioLines, Captions, FileAudio } from "lucide-react";
import { useState } from "react";
import styles from "./TimelinePanel.module.css";

const languages = ["English", "Spanish", "French", "German", "Portuguese", "Italian", "Arabic", "Hindi", "Japanese", "Korean", "Chinese"];

export function TimelineLanguageTools({ clipSelected }: { clipSelected: boolean }) {
  const [language, setLanguage] = useState("Spanish");
  const title = clipSelected ? "Language translation is not connected yet" : "Select a clip to translate";
  return (
    <nav aria-label="Language tools" className={`${styles.accessibilityTools} ${styles.languageTools}`}>
      <label className={styles.languagePicker}>
        <Image alt="" height={15} src="/accessible-media-icons/language-svgrepo-com.svg" width={15} />
        <select aria-label="Target language" disabled={!clipSelected} onChange={(event) => setLanguage(event.target.value)} value={language}>
          {languages.map((option) => <option key={option}>{option}</option>)}
        </select>
      </label>
      <button aria-label={`Translate captions to ${language}`} disabled title={title} type="button"><Captions size={15} /><span>Captions</span></button>
      <button aria-label={`Translate spoken audio to ${language}`} disabled title={title} type="button"><FileAudio size={15} /><span>Audio</span></button>
      <button aria-label={`Translate descriptions to ${language}`} disabled title={title} type="button"><AudioLines size={15} /><span>Descriptions</span></button>
    </nav>
  );
}
