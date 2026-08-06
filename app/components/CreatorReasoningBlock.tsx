"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import type { CreatorBlock } from "./creatorChatTypes";
import { CreatorMarkdown } from "./CreatorMarkdown";
import styles from "./CreatorReasoningBlock.module.css";

type Reasoning = Extract<CreatorBlock, { kind: "reasoning" }>;

export function CreatorReasoningBlock({ block }: { block: Reasoning }) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const streaming = !block.finishedAt;
  useEffect(() => {
    if (!streaming) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [streaming]);
  const expanded = streaming || open;
  const seconds = Math.max(1, Math.round(((block.finishedAt || now) - (block.startedAt || now)) / 1000));
  return <section className={styles.reasoning}><button onClick={() => setOpen((value) => !value)} type="button">{expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{streaming ? `Thinking ${seconds}s` : `Thought for ${seconds}s`}{streaming && <i />}</button>{expanded && <CreatorMarkdown content={block.content} />}</section>;
}
