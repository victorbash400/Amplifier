"use client";

import { ArrowUp, Paperclip, PanelLeft } from "lucide-react";
import { useState } from "react";
import styles from "./CreatorPanel.module.css";

export function CreatorPanel() {
  const [input, setInput] = useState("");
  return <aside className={styles.panel} aria-label="Creator"><header><button aria-label="Open chat drawer" type="button"><PanelLeft size={16} /></button></header><section /><form className={styles.input} onSubmit={(event) => event.preventDefault()}><textarea aria-label="Message Creator" onChange={(event) => setInput(event.target.value)} placeholder="Ask Creator" rows={1} value={input} /><button aria-label="Attach" type="button"><Paperclip size={15} /></button><button aria-label="Send" disabled={!input.trim()} type="submit"><ArrowUp size={16} /></button></form></aside>;
}
