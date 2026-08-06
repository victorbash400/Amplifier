import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./CreatorMarkdown.module.css";

export function CreatorMarkdown({ content }: { content: string }) {
  return <div className={styles.markdown}><Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown></div>;
}
