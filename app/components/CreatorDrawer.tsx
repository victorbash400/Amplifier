"use client";

import { PanelLeft, Search, SquarePen } from "lucide-react";
import { useState } from "react";
import type { CreatorChat } from "./creatorChatTypes";
import styles from "./CreatorDrawer.module.css";

type CreatorDrawerProps = {
  activeChatId: string;
  chats: CreatorChat[];
  onClose: () => void;
  onNewChat: () => void;
  onSelect: (id: string) => void;
  open: boolean;
};

export function CreatorDrawer({ activeChatId, chats, onClose, onNewChat, onSelect, open }: CreatorDrawerProps) {
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const matches = chats.filter((chat) => chat.title.toLowerCase().includes(query.trim().toLowerCase()));

  return <><button aria-label="Close chat drawer" className={styles.backdrop} data-open={open} disabled={!open} onClick={onClose} type="button" /><aside aria-hidden={!open} aria-label="Chat drawer" className={styles.drawer} data-open={open} inert={!open}><header><button aria-label="Close chat drawer" onClick={onClose} type="button"><PanelLeft size={16} /></button></header><nav><button onClick={onNewChat} type="button"><SquarePen size={16} />New chat</button><button aria-expanded={searching} onClick={() => setSearching((current) => !current)} type="button"><Search size={16} />Search chats</button>{searching && <label><Search aria-hidden="true" size={14} /><input autoFocus={open} onChange={(event) => setQuery(event.target.value)} placeholder="Search chats" value={query} /></label>}<section aria-label="Chat history" className={styles.history}>{matches.map((chat) => <button aria-current={chat.id === activeChatId ? "page" : undefined} key={chat.id} onClick={() => onSelect(chat.id)} type="button">{chat.title}</button>)}{!matches.length && <p>No chats found.</p>}</section></nav></aside></>;
}
