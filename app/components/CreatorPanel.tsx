"use client";

import { PanelLeft } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
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
import type { TimelineDocument } from "../lib/timelineDocument";
import { captureTimelineShot, type TimelineShot } from "../lib/timelineShot";
import type { ProjectFile } from "../types/workspace";
import { TimelineShotFlight, type ShotRect } from "./TimelineShotFlight";
import styles from "./CreatorPanel.module.css";

export type CreatorPanelHandle = {
  requestAgent: (request: CreatorAgentRequest) => void;
};

type CreatorPanelProps = {
  hidden: boolean;
  files: ProjectFile[];
  onActivityChange: (active: boolean) => void;
  onToolResponse: (result: Record<string, unknown>) => void;
  playhead: number;
  projectId: string;
  selectedClipIds: string[];
  timeline: TimelineDocument;
};

export const CreatorPanel = forwardRef<CreatorPanelHandle, CreatorPanelProps>(function CreatorPanel({ files, hidden, onActivityChange, onToolResponse, playhead, projectId, selectedClipIds, timeline }, ref) {
  const [chats, setChats] = useState<CreatorChat[]>([]);
  const [activeChatId, setActiveChatId] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string>();
  const [pendingAgentRequest, setPendingAgentRequest] = useState<CreatorAgentRequest>();
  const [changingChat, setChangingChat] = useState(false);
  const [timelineShot, setTimelineShot] = useState<TimelineShot>();
  const [shotFlight, setShotFlight] = useState<{ destination: ShotRect; image: string; source: ShotRect }>();
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const activeChat = chats.find((chat) => chat.id === activeChatId);
  const finishShotFlight = useCallback(() => setShotFlight(undefined), []);

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
    setTimelineShot(undefined);
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
    setTimelineShot(undefined);
  }

  async function send() {
    const content = input.trim();
    const chatId = activeChat?.id;
    if (!content || streaming || !chatId) return;
    const submittedShot = timelineShot;
    updateMessages(chatId, (messages) => [...finishReasoning(messages), { id: crypto.randomUUID(), role: "user", blocks: [...(submittedShot ? [{ id: crypto.randomUUID(), kind: "timeline-shot" as const, shot: submittedShot }] : []), { id: crypto.randomUUID(), kind: "text" as const, content }] }]);
    setInput("");
    setTimelineShot(undefined);
    setError(undefined);
    setStreaming(true);
    onActivityChange(true);
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      await streamCreatorMessage({ agentId: activeChat.agentId || "general", message: content, playhead, projectId, selectedClipIds, sessionId: chatId, signal: controller.signal, timeline, timelineRevision: timeline.revision, timelineShot: submittedShot, onEvent: (event) => {
        if (event.type === "title") {
          setChats((current) => current.map((chat) => chat.id === chatId ? { ...chat, title: event.title, updatedAt: Date.now() } : chat));
          return;
        }
        if (event.type === "tool_response") onToolResponse(event.result);
        updateMessages(chatId, (messages) => applyCreatorEvent(messages, event));
      } });
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : "Creator chat failed");
    } finally {
      updateMessages(chatId, (messages) => finishReasoning(messages));
      setStreaming(false);
      onActivityChange(false);
      controllerRef.current = undefined;
    }
  }

  async function captureShot() {
    try {
      const sourceElement = document.querySelector<HTMLElement>('[aria-label="Editable timeline"]');
      if (!sourceElement) throw new Error("The timeline is not visible");
      const source = rect(sourceElement.getBoundingClientRect());
      const shot = await captureTimelineShot(projectId, timeline, files, playhead, selectedClipIds);
      setTimelineShot(shot);
      requestAnimationFrame(() => {
        const destinationElement = document.querySelector<HTMLElement>("[data-timeline-shot-card]");
        if (destinationElement) setShotFlight({ destination: rect(destinationElement.getBoundingClientRect()), image: shot.image, source });
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not capture the timeline");
    }
  }

  if (!loaded) return <aside className={styles.panel} aria-label="Creator" hidden={hidden} />;

  return (
      <aside className={styles.panel} aria-label="Creator" hidden={hidden}>
        <header className={styles.chatHeader}>
          <button aria-label="Open chat drawer" onClick={() => setDrawerOpen(true)} type="button"><PanelLeft size={16} /></button>
          <strong>{creatorAgentName(activeChat?.agentId || "general")}</strong>
        </header>
        <CreatorMessageList messages={activeChat?.messages ?? []} waiting={streaming && activeChat?.messages.at(-1)?.role === "user"} />
        {error && <p className={styles.error} role="alert">{error}</p>}
        {pendingAgentRequest && <CreatorAgentChoice agentId={pendingAgentRequest.agentId} disabled={changingChat || streaming} onBranch={() => void branchWithAgent()} onCancel={() => setPendingAgentRequest(undefined)} onContinue={continueWithAgent} onNewChat={() => startNewChat(pendingAgentRequest.agentId, pendingAgentRequest.contextNames)} />}
        <CreatorChatInput agentName={creatorAgentName(activeChat?.agentId || "general")} contextNames={activeChat?.contextNames || []} disabled={streaming || changingChat || !activeChat} input={input} onCaptureTimeline={() => void captureShot()} onConnect={() => setError("Project asset connections are not configured yet")} onInputChange={setInput} onRemoveTimelineShot={() => setTimelineShot(undefined)} onSend={send} timelineShot={timelineShot} />
        <CreatorDrawer activeChatId={activeChatId} chats={chats} onClose={() => setDrawerOpen(false)} onNewChat={() => startNewChat()} onSelect={openChat} open={drawerOpen} />
        {shotFlight && <TimelineShotFlight destination={shotFlight.destination} image={shotFlight.image} onFinish={finishShotFlight} source={shotFlight.source} />}
      </aside>
  );
});

function rect(value: DOMRect): ShotRect {
  return { left: value.left, top: value.top, width: value.width, height: value.height };
}
