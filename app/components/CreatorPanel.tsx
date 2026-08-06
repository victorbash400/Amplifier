"use client";

import { PanelLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createCreatorChat, loadCreatorChats, saveCreatorChats } from "../lib/creatorChatStorage";
import { applyCreatorEvent, finishReasoning } from "../lib/creatorMessages";
import { streamCreatorMessage } from "../lib/creatorStream";
import { CreatorChatSearchModal } from "./CreatorChatSearchModal";
import { CreatorDrawer } from "./CreatorDrawer";
import { CreatorChatInput } from "./CreatorChatInput";
import { CreatorMessageList } from "./CreatorMessageList";
import type { CreatorChat, CreatorMessage } from "./creatorChatTypes";
import styles from "./CreatorPanel.module.css";

export function CreatorPanel({ projectId }: { projectId: string }) {
  const [chats, setChats] = useState<CreatorChat[]>([]);
  const [activeChatId, setActiveChatId] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string>();
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const activeChat = chats.find((chat) => chat.id === activeChatId);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const storedChats = loadCreatorChats(projectId);
        const initialChats = storedChats.length ? storedChats : [createCreatorChat(projectId)];
        setChats(initialChats);
        setActiveChatId(initialChats[0].id);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Could not load chat history.");
      } finally {
        setLoaded(true);
      }
    });
    return () => {
      window.cancelAnimationFrame(frame);
      controllerRef.current?.abort();
    };
  }, [projectId]);

  useEffect(() => {
    if (!loaded || !chats.length) return;
    const frame = window.requestAnimationFrame(() => {
      try {
        saveCreatorChats(projectId, chats);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Could not save chat history.");
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [chats, loaded, projectId]);

  function updateMessages(chatId: string, update: (messages: CreatorMessage[]) => CreatorMessage[]) {
    setChats((current) => current.map((chat) => chat.id === chatId ? {
      ...chat,
      messages: update(chat.messages),
      updatedAt: Date.now(),
    } : chat));
  }

  function startNewChat() {
    controllerRef.current?.abort();
    const chat = createCreatorChat(projectId);
    setChats((current) => [chat, ...current]);
    setActiveChatId(chat.id);
    setInput("");
    setStreaming(false);
    setError(undefined);
    setDrawerOpen(false);
    setSearchOpen(false);
  }

  function openChat(chatId: string) {
    if (chatId === activeChatId) {
      setDrawerOpen(false);
      setSearchOpen(false);
      return;
    }
    controllerRef.current?.abort();
    setActiveChatId(chatId);
    setInput("");
    setStreaming(false);
    setError(undefined);
    setDrawerOpen(false);
    setSearchOpen(false);
  }

  async function send() {
    const content = input.trim();
    const chatId = activeChat?.id;
    if (!content || streaming || !chatId) return;
    updateMessages(chatId, (messages) => [...finishReasoning(messages), { id: crypto.randomUUID(), role: "user", blocks: [{ id: crypto.randomUUID(), kind: "text", content }] }]);
    setInput("");
    setError(undefined);
    setStreaming(true);
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      await streamCreatorMessage({ message: content, projectId, sessionId: chatId, signal: controller.signal, onEvent: (event) => {
        if (event.type === "title") {
          setChats((current) => current.map((chat) => chat.id === chatId ? { ...chat, title: event.title, updatedAt: Date.now() } : chat));
          return;
        }
        updateMessages(chatId, (messages) => applyCreatorEvent(messages, event));
      } });
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : "Creator chat failed");
    } finally {
      updateMessages(chatId, (messages) => finishReasoning(messages));
      setStreaming(false);
      controllerRef.current = undefined;
    }
  }

  if (!loaded) return <aside className={styles.panel} aria-label="Creator" />;

  return <aside className={styles.panel} aria-label="Creator"><header className={styles.chatHeader}><button aria-label="Open chat drawer" onClick={() => setDrawerOpen(true)} type="button"><PanelLeft size={16} /></button></header><CreatorMessageList messages={activeChat?.messages ?? []} waiting={streaming && activeChat?.messages.at(-1)?.role === "user"} />{error && <p className={styles.error} role="alert">{error}</p>}<CreatorChatInput disabled={streaming || !activeChat} input={input} onConnect={() => setError("Project asset connections are not configured yet")} onInputChange={setInput} onSend={send} />{drawerOpen && <CreatorDrawer onClose={() => setDrawerOpen(false)} onNewChat={startNewChat} onSearch={() => { setDrawerOpen(false); setSearchOpen(true); }} />}{searchOpen && <CreatorChatSearchModal chats={chats} onClose={() => setSearchOpen(false)} onSelect={openChat} />}</aside>;
}
