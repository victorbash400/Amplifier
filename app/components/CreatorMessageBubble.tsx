import type { CreatorMessage } from "./creatorChatTypes";
import { CreatorMarkdown } from "./CreatorMarkdown";
import { CreatorReasoningBlock } from "./CreatorReasoningBlock";
import { CreatorToolCallIndicator } from "./CreatorToolCallIndicator";
import styles from "./CreatorMessageBubble.module.css";

export function CreatorMessageBubble({ message }: { message: CreatorMessage }) {
  return <article className={styles.message} data-role={message.role}>{message.blocks.map((block) => block.kind === "reasoning" ? <CreatorReasoningBlock block={block} key={block.id} /> : block.kind === "tool" ? <CreatorToolCallIndicator key={block.id} tool={block.tool} /> : <CreatorMarkdown content={block.content} key={block.id} />)}</article>;
}
