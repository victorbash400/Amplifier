"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import type { CreatorBlock } from "./creatorChatTypes";
import { CreatorMarkdown } from "./CreatorMarkdown";
import styles from "./CreatorReasoningBlock.module.css";

type Reasoning = Extract<CreatorBlock, { kind: "reasoning" }>;

export function CreatorReasoningBlock({ block }: { block: Reasoning }) {
  const [open, setOpen] = useState(false);
  const streaming = !block.finishedAt;
  const expanded = streaming || open;
  const seconds = block.finishedAt && block.startedAt ? Math.max(1, Math.round((block.finishedAt - block.startedAt) / 1000)) : undefined;
  return <section className={styles.reasoning}><button onClick={() => setOpen((value) => !value)} type="button">{expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{streaming ? "Thinking" : `Thought for ${seconds ?? 1}s`}{streaming && <i />}</button>{expanded && <CreatorMarkdown content={block.content} />}</section>;
}
