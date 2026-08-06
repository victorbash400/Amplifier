import { PanelLeft, Search, SquarePen } from "lucide-react";
import styles from "./CreatorDrawer.module.css";

export function CreatorDrawer({ onClose, onNewChat, onSearch }: { onClose: () => void; onNewChat: () => void; onSearch: () => void }) {
  return <><button aria-label="Close chat drawer" className={styles.backdrop} onClick={onClose} type="button" /><aside aria-label="Chat drawer" className={styles.drawer}><header><button aria-label="Close chat drawer" onClick={onClose} type="button"><PanelLeft size={16} /></button></header><nav><button onClick={onNewChat} type="button"><SquarePen size={16} />New chat</button><button onClick={onSearch} type="button"><Search size={16} />Search chats</button></nav></aside></>;
}
