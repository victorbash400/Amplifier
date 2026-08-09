"use client";

import Image from "next/image";
import { ArrowUp, ScanLine } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { CreatorChatContext } from "./CreatorChatContext";
import type { TimelineShot } from "../lib/timelineShot";
import { TimelineShotAttachment } from "./TimelineShotAttachment";
import styles from "./CreatorChatInput.module.css";

type CreatorChatInputProps = {
  disabled: boolean;
  input: string;
  onConnect: () => void;
  onInputChange: (value: string) => void;
  onSend: () => void;
  agentName: string;
  contextNames: string[];
  onCaptureTimeline: () => void;
  onRemoveTimelineShot: () => void;
  timelineShot?: TimelineShot;
};

export function CreatorChatInput({ agentName, contextNames, disabled, input, onCaptureTimeline, onConnect, onInputChange, onRemoveTimelineShot, onSend, timelineShot }: CreatorChatInputProps) {
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const canSend = input.trim().length > 0 && !disabled;
  useLayoutEffect(() => {
    const textarea = textAreaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [input]);
  return (
    <form className={styles.form} onSubmit={(event) => { event.preventDefault(); if (canSend) onSend(); }}>
      <CreatorChatContext agentName={agentName} contextNames={contextNames} />
      <section className={styles.composer}>
        {timelineShot && <TimelineShotAttachment onRemove={onRemoveTimelineShot} shot={timelineShot} />}
        <textarea aria-label={`Message ${agentName}`} disabled={disabled} onChange={(event) => onInputChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); if (canSend) onSend(); } }} placeholder={`Ask ${agentName}`} ref={textAreaRef} rows={2} value={input} />
        <footer className={styles.toolbar}>
          <span className={styles.attachments}><button aria-label="Connect project assets" disabled={disabled} onClick={onConnect} title="Connect project assets" type="button"><Image alt="" height={17} src="/connect-svgrepo-com.svg" width={17} /></button><button aria-label="Capture Timeline Shot" disabled={disabled} onClick={onCaptureTimeline} title="Capture Timeline Shot" type="button"><ScanLine size={17} /></button></span>
          <button aria-label="Send" disabled={!canSend} type="submit"><ArrowUp size={16} /></button>
        </footer>
      </section>
    </form>
  );
}
