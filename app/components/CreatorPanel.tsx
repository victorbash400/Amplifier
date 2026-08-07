"use client";

import { PanelLeft } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createCreatorChat, loadCreatorChats, saveCreatorChats } from "../lib/creatorChatStorage";
import { applyCreatorEvent, finishReasoning } from "../lib/creatorMessages";
import { streamCreatorMessage } from "../lib/creatorStream";
import { branchCreatorSession } from "../lib/creatorSessions";
import { CreatorAgentChoice } from "./CreatorAgentChoice";
import { CreatorDrawer } from "./CreatorDrawer";
import { CreatorChatInput } from "./CreatorChatInput";
import { CreatorMessageList } from "./CreatorMessageList";
import type { CreatorChat, CreatorMessage } from "./creatorChatTypes";
import { creatorAgentName, type CreatorAgentId, type CreatorAgentRequest } from "./creatorAgentTypes";
import styles from "./CreatorPanel.module.css";

export type CreatorPanelHandle = {
  requestAgent: (request: CreatorAgentRequest) => void;
};

export const CreatorPanel = forwardRef<CreatorPanelHandle, { hidden: boolean; projectId: string }>(function CreatorPanel({ hidden, projectId }, ref) {
  const [chats, setChats] = useState<CreatorChat[]>([]);
  const [activeChatId, setActiveChatId] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string>();
  const [pendingAgentRequest, setPendingAgentRequest] = useState<CreatorAgentRequest>();
  const [changingChat, setChangingChat] = useState(false);
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

  function startNewChat(agentId: CreatorAgentId = "general", contextNames: string[] = []) {
    controllerRef.current?.abort();
    const chat = createCreatorChat(projectId, agentId, contextNames);
    setChats((current) => [chat, ...current]);
    setActiveChatId(chat.id);
    setInput("");
    setStreaming(false);
    setError(undefined);
    setDrawerOpen(false);
    setPendingAgentRequest(undefined);
  }

  useImperativeHandle(ref, () => ({
    requestAgent(request) {
      if (activeChat?.messages.length) {
        setPendingAgentRequest(request);
        return;
      }
      if (activeChat) {
        setChats((current) => current.map((chat) => chat.id === activeChat.id ? {
          ...chat,
          agentId: request.agentId,
          contextNames: request.contextNames,
          updatedAt: Date.now(),
        } : chat));
        return;
      }
      const chat = createCreatorChat(projectId, request.agentId, request.contextNames);
      setChats((current) => [chat, ...current]);
      setActiveChatId(chat.id);
      setPendingAgentRequest(undefined);
    },
  }), [activeChat, projectId]);

  function continueWithAgent() {
    if (!activeChat || !pendingAgentRequest) return;
    setChats((current) => current.map((chat) => chat.id === activeChat.id ? {
      ...chat,
      agentId: pendingAgentRequest.agentId,
      contextNames: pendingAgentRequest.contextNames,
      updatedAt: Date.now(),
    } : chat));
    setPendingAgentRequest(undefined);
  }

  async function branchWithAgent() {
    if (!activeChat || !pendingAgentRequest || changingChat) return;
    const sourceChat = activeChat;
    const request = pendingAgentRequest;
    const branch = createCreatorChat(projectId, request.agentId, request.contextNames);
    setChangingChat(true);
    setError(undefined);
    try {
      await branchCreatorSession(sourceChat.id, branch.id, request.agentId);
      branch.title = sourceChat.title;
      branch.messages = structuredClone(sourceChat.messages);
      setChats((current) => [branch, ...current]);
      setActiveChatId(branch.id);
      setPendingAgentRequest(undefined);
      setInput("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not branch chat.");
    } finally {
      setChangingChat(false);
    }
  }

  function openChat(chatId: string) {
    if (chatId === activeChatId) {
      setDrawerOpen(false);
      return;
    }
    controllerRef.current?.abort();
    setActiveChatId(chatId);
    setInput("");
    setStreaming(false);
    setError(undefined);
    setDrawerOpen(false);
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
      await streamCreatorMessage({ agentId: activeChat.agentId || "general", message: content, projectId, sessionId: chatId, signal: controller.signal, onEvent: (event) => {
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

  if (!loaded) return <aside className={styles.panel} aria-label="Creator" hidden={hidden} />;

  return <aside className={styles.panel} aria-label="Creator" hidden={hidden}><header className={styles.chatHeader}><button aria-label="Open chat drawer" onClick={() => setDrawerOpen(true)} type="button"><PanelLeft size={16} /></button><strong>{creatorAgentName(activeChat?.agentId || "general")}</strong></header><CreatorMessageList messages={activeChat?.messages ?? []} waiting={streaming && activeChat?.messages.at(-1)?.role === "user"} />{error && <p className={styles.error} role="alert">{error}</p>}{pendingAgentRequest && <CreatorAgentChoice agentId={pendingAgentRequest.agentId} disabled={changingChat || streaming} onBranch={() => void branchWithAgent()} onCancel={() => setPendingAgentRequest(undefined)} onContinue={continueWithAgent} onNewChat={() => startNewChat(pendingAgentRequest.agentId, pendingAgentRequest.contextNames)} />}<CreatorChatInput agentName={creatorAgentName(activeChat?.agentId || "general")} contextNames={activeChat?.contextNames || []} disabled={streaming || changingChat || !activeChat} input={input} onConnect={() => setError("Project asset connections are not configured yet")} onInputChange={setInput} onSend={send} />{drawerOpen && <CreatorDrawer activeChatId={activeChatId} chats={chats} onClose={() => setDrawerOpen(false)} onNewChat={() => startNewChat()} onSelect={openChat} />}</aside>;
});
