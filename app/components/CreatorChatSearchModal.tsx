"use client";

import { Search, X } from "lucide-react";
import { useState } from "react";
import type { CreatorChat } from "./creatorChatTypes";
import styles from "./CreatorChatSearchModal.module.css";

export function CreatorChatSearchModal({ chats, onClose, onSelect }: { chats: CreatorChat[]; onClose: () => void; onSelect: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const matches = chats.filter((chat) => chat.title.toLowerCase().includes(query.trim().toLowerCase()));
  return <section aria-labelledby="chat-search-title" aria-modal="true" className={styles.backdrop} role="dialog"><section className={styles.modal}><header><strong id="chat-search-title">Search chats</strong><button aria-label="Close search" onClick={onClose} type="button"><X size={15} /></button></header><label><Search size={14} /><input autoFocus onChange={(event) => setQuery(event.target.value)} placeholder="Search chats" value={query} /></label><nav>{matches.map((chat) => <button key={chat.id} onClick={() => onSelect(chat.id)} type="button">{chat.title}</button>)}{!matches.length && <p>No chats found.</p>}</nav></section></section>;
}
