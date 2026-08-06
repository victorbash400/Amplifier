"use client";

import { useEffect, useRef } from "react";
import type { CreatorMessage } from "./creatorChatTypes";
import { CreatorMessageBubble } from "./CreatorMessageBubble";
import { CreatorTypingIndicator } from "./CreatorTypingIndicator";
import styles from "./CreatorMessageList.module.css";

export function CreatorMessageList({ messages, waiting }: { messages: CreatorMessage[]; waiting: boolean }) {
  const listRef = useRef<HTMLElement>(null);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [messages, waiting]);
  return <section aria-live="polite" className={styles.messages} ref={listRef}>{messages.map((message) => <CreatorMessageBubble key={message.id} message={message} />)}{waiting && <CreatorTypingIndicator />}</section>;
}
