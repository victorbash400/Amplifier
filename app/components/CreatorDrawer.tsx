"use client";

import { GitBranch, PanelLeft, Search, SquarePen, Trash2 } from "lucide-react";
import { useState } from "react";
import type { CreatorChat } from "./creatorChatTypes";
import styles from "./CreatorDrawer.module.css";

type CreatorDrawerProps = {
  activeChatId: string;
  chats: CreatorChat[];
  deleteDisabled: boolean;
  onClose: () => void;
  onDelete: (chat: CreatorChat) => void;
  onNewChat: () => void;
  onSelect: (id: string) => void;
  open: boolean;
};

export function CreatorDrawer({ activeChatId, chats, deleteDisabled, onClose, onDelete, onNewChat, onSelect, open }: CreatorDrawerProps) {
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const matches = chats.filter((chat) => chat.title.toLowerCase().includes(query.trim().toLowerCase()));

  return <><button aria-label="Close chat drawer" className={styles.backdrop} data-open={open} disabled={!open} onClick={onClose} type="button" /><aside aria-hidden={!open} aria-label="Chat drawer" className={styles.drawer} data-open={open} inert={!open}><header><button aria-label="Close chat drawer" onClick={onClose} type="button"><PanelLeft size={16} /></button></header><nav><button onClick={onNewChat} type="button"><SquarePen size={16} />New chat</button><button aria-expanded={searching} onClick={() => setSearching((current) => !current)} type="button"><Search size={16} />Search chats</button>{searching && <label><Search aria-hidden="true" size={14} /><input autoFocus={open} onChange={(event) => setQuery(event.target.value)} placeholder="Search chats" value={query} /></label>}<section aria-label="Chat history" className={styles.history}>{matches.map((chat) => <article key={chat.id}><button aria-current={chat.id === activeChatId ? "page" : undefined} className={styles.chat} onClick={() => onSelect(chat.id)} type="button">{chat.branchedFromChatId && <GitBranch aria-label="Branched chat" size={13} />}<span>{chat.title}</span></button><button aria-label={`Delete ${chat.title}`} className={styles.remove} disabled={deleteDisabled} onClick={() => onDelete(chat)} title="Delete chat" type="button"><Trash2 size={13} /></button></article>)}{!matches.length && <p>No chats found.</p>}</section></nav></aside></>;
}
