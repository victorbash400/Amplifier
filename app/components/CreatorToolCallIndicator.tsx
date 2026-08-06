import { SquareTerminal } from "lucide-react";
import type { CreatorToolCall } from "./creatorChatTypes";
import styles from "./CreatorToolCallIndicator.module.css";

export function CreatorToolCallIndicator({ tool }: { tool: CreatorToolCall }) {
  return <span className={styles.tool} data-status={tool.status}><SquareTerminal size={14} /><strong>{tool.name.replaceAll("_", " ")}</strong></span>;
}
