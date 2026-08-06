"use client";

import Image from "next/image";
import { ArrowUp } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import styles from "./CreatorChatInput.module.css";

type CreatorChatInputProps = {
  disabled: boolean;
  input: string;
  onConnect: () => void;
  onInputChange: (value: string) => void;
  onSend: () => void;
};

export function CreatorChatInput({ disabled, input, onConnect, onInputChange, onSend }: CreatorChatInputProps) {
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const canSend = input.trim().length > 0 && !disabled;
  useLayoutEffect(() => {
    const textarea = textAreaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [input]);
  return <form className={styles.input} onSubmit={(event) => { event.preventDefault(); if (canSend) onSend(); }}><textarea aria-label="Message Creator" disabled={disabled} onChange={(event) => onInputChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); if (canSend) onSend(); } }} placeholder="Describe what you want to create" ref={textAreaRef} rows={1} value={input} /><button aria-label="Connect project assets" disabled={disabled} onClick={onConnect} title="Connect project assets" type="button"><Image alt="" height={17} src="/connect-svgrepo-com.svg" width={17} /></button><button aria-label="Send" disabled={!canSend} type="submit"><ArrowUp size={16} /></button></form>;
}
