"use client";

import { PanelLeft } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createCreatorChat, loadCreatorChats, saveCreatorChats } from "../lib/creatorChatStorage";
import { applyCreatorEvent, finishReasoning } from "../lib/creatorMessages";
import { streamCreatorMessage } from "../lib/creatorStream";
import { branchCreatorSession, deleteCreatorSession } from "../lib/creatorSessions";
import { CreatorAgentChoice } from "./CreatorAgentChoice";
import { CreatorDrawer } from "./CreatorDrawer";
import { CreatorChatInput } from "./CreatorChatInput";
import { CreatorMessageList } from "./CreatorMessageList";
import type { CreatorChat, CreatorMessage } from "./creatorChatTypes";
import { creatorAgentName, type CreatorAgentId, type CreatorAgentRequest, type CreatorSpecialistAgentId } from "./creatorAgentTypes";
import type { TimelineDocument } from "../lib/timelineDocument";
import { captureTimelineShot, timelineShotFromToolResult, type TimelineShot } from "../lib/timelineShot";
import type { ProjectFile } from "../types/workspace";
import { TimelineShotFlight, type ShotRect } from "./TimelineShotFlight";
import { CreatorSkillsModal } from "./CreatorSkillsModal";
import { CreatorChatDeleteDialog } from "./CreatorChatDeleteDialog";
import { CreatorActiveSubagent } from "./CreatorActiveSubagent";
import { loadChatSkills, updateChatSkills, type ChatSkillsContext, type SkillDetail } from "../lib/skills";
import styles from "./CreatorPanel.module.css";

export type CreatorPanelHandle = {
  requestAgent: (request: CreatorAgentRequest) => void;
};

type CreatorPanelProps = {
  hidden: boolean;
  files: ProjectFile[];
  onActiveAgentChange: (agentId?: CreatorAgentId) => void;
  onTimelineActivityChange: (active: boolean) => void;
  onToolResponse: (result: Record<string, unknown>) => void;
  playhead: number;
  projectId: string;
  selectedClipIds: string[];
  timeline: TimelineDocument;
};

export const CreatorPanel = forwardRef<CreatorPanelHandle, CreatorPanelProps>(function CreatorPanel({ files, hidden, onActiveAgentChange, onTimelineActivityChange, onToolResponse, playhead, projectId, selectedClipIds, timeline }, ref) {
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
  const [mcpOpen, setMcpOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [skillsContext, setSkillsContext] = useState<ChatSkillsContext>();
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsChanging, setSkillsChanging] = useState(false);
  const [skillsError, setSkillsError] = useState<string>();
  const [chatToDelete, setChatToDelete] = useState<CreatorChat>();
  const [deletingChat, setDeletingChat] = useState(false);
  const [activeSubagent, setActiveSubagent] = useState<CreatorSpecialistAgentId>();
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const timelineActivityRef = useRef(false);
  const activeChat = chats.find((chat) => chat.id === activeChatId);
  const finishShotFlight = useCallback(() => setShotFlight(undefined), []);
  const closeMcp = useCallback(() => setMcpOpen(false), []);
  const closeSkills = useCallback(() => setSkillsOpen(false), []);

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

  useEffect(() => {
    if (!activeChatId) {
      setSkillsContext(undefined);
      return;
    }
    let active = true;
    setSkillsLoading(true);
    setSkillsError(undefined);
    void loadChatSkills(projectId, activeChatId).then((context) => { if (active) setSkillsContext(context); }).catch((reason) => { if (active) setSkillsError(reason instanceof Error ? reason.message : "Could not load skills"); }).finally(() => { if (active) setSkillsLoading(false); });
    return () => { active = false; };
  }, [activeChatId, projectId]);

  function updateMessages(chatId: string, update: (messages: CreatorMessage[]) => CreatorMessage[]) {
    setChats((current) => current.map((chat) => chat.id === chatId ? {
      ...chat,
      messages: update(chat.messages),
      updatedAt: Date.now(),
    } : chat));
  }

  function startNewChat(agentId: CreatorAgentId = "edit", contextNames: string[] = []) {
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
    setActiveSubagent(undefined);
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
      branch.branchedFromChatId = sourceChat.id;
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
    setActiveSubagent(undefined);
  }

  async function deleteChat() {
    if (!chatToDelete || deletingChat) return;
    const target = chatToDelete;
    setDeletingChat(true);
    setError(undefined);
    try {
      await deleteCreatorSession(target.id);
      const deletingActive = target.id === activeChatId;
      const remaining = chats.filter((chat) => chat.id !== target.id);
      const next = remaining.length ? remaining : [createCreatorChat(projectId)];
      setChats(next);
      if (deletingActive) setActiveChatId(next[0].id);
      setChatToDelete(undefined);
      if (deletingActive) {
        setInput("");
        setTimelineShot(undefined);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not delete chat.");
    } finally {
      setDeletingChat(false);
    }
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
    timelineActivityRef.current = false;
    onTimelineActivityChange(false);
    onActiveAgentChange(activeChat.agentId || "edit");
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      await streamCreatorMessage({ agentId: activeChat.agentId || "edit", message: content, playhead, projectId, selectedClipIds, sessionId: chatId, signal: controller.signal, timeline, timelineRevision: timeline.revision, timelineShot: submittedShot, onEvent: (event) => {
        if (event.type === "tool_call" && event.surface === "timeline" && !timelineActivityRef.current) {
          timelineActivityRef.current = true;
          onTimelineActivityChange(true);
        }
        if (event.type === "agent_start") { setActiveSubagent(event.agent); onActiveAgentChange(event.agent); }
        if (event.type === "agent_return") { setActiveSubagent(undefined); onActiveAgentChange("edit"); }
        if (event.type === "title") {
          setChats((current) => current.map((chat) => chat.id === chatId ? { ...chat, title: event.title, updatedAt: Date.now() } : chat));
          return;
        }
        if (event.type === "tool_response") {
          onToolResponse(event.result);
          if (event.name === "read_timeline_shot") showAgentTimelineShot(chatId, event.result);
        }
        updateMessages(chatId, (messages) => applyCreatorEvent(messages, event));
      } });
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : "Creator chat failed");
    } finally {
      updateMessages(chatId, (messages) => finishReasoning(messages));
      timelineActivityRef.current = false;
      onTimelineActivityChange(false);
      onActiveAgentChange(undefined);
      setActiveSubagent(undefined);
      setStreaming(false);
      controllerRef.current = undefined;
    }
  }

  function showAgentTimelineShot(chatId: string, result: Record<string, unknown>) {
    const shot = timelineShotFromToolResult(projectId, result, files);
    const sourceElement = document.querySelector<HTMLElement>('[aria-label="Editable timeline"]');
    if (!shot || !sourceElement) return;
    const source = rect(sourceElement.getBoundingClientRect());
    updateMessages(chatId, (messages) => messages.map((message, index) => index === messages.length - 1 && message.role === "assistant" ? { ...message, blocks: [...message.blocks, { id: crypto.randomUUID(), kind: "timeline-shot" as const, shot }] } : message));
    requestAnimationFrame(() => {
      const destinationElement = document.querySelector<HTMLElement>(`[data-timeline-shot-id="${CSS.escape(shot.id)}"]`);
      if (destinationElement) setShotFlight({ destination: rect(destinationElement.getBoundingClientRect()), image: shot.image, source });
    });
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

  async function selectSkills(skillIds: string[]) {
    if (!activeChat || skillsChanging) return;
    setSkillsChanging(true);
    setSkillsError(undefined);
    try {
      setSkillsContext(await updateChatSkills(projectId, activeChat.id, skillIds));
    } catch (reason) {
      setSkillsError(reason instanceof Error ? reason.message : "Could not update skills");
    } finally {
      setSkillsChanging(false);
    }
  }

  function savedSkill(skill: SkillDetail) {
    const selected = skillsContext?.selected_skill_ids || [];
    void selectSkills(selected.includes(skill.id) ? selected : [...selected, skill.id]);
  }

  const selectedSkills = (skillsContext?.available_skills || []).filter((skill) => skillsContext?.selected_skill_ids.includes(skill.id));

  if (!loaded) return <aside className={styles.panel} aria-label="Agent" hidden={hidden} />;

  return (
      <aside className={styles.panel} aria-label="Agent" hidden={hidden}>
        <header className={styles.chatHeader}>
          <button aria-label="Open chat drawer" onClick={() => setDrawerOpen(true)} type="button"><PanelLeft size={16} /></button>
          <strong>Agent</strong>
          <CreatorActiveSubagent agentId={activeSubagent} />
        </header>
        <CreatorMessageList messages={activeChat?.messages ?? []} waiting={streaming && activeChat?.messages.at(-1)?.role === "user"} />
        {error && <p className={styles.error} role="alert">{error}</p>}
        {pendingAgentRequest && <CreatorAgentChoice agentId={pendingAgentRequest.agentId} disabled={changingChat || streaming} onBranch={() => void branchWithAgent()} onCancel={() => setPendingAgentRequest(undefined)} onContinue={continueWithAgent} onNewChat={() => startNewChat(pendingAgentRequest.agentId, pendingAgentRequest.contextNames)} />}
        <CreatorChatInput agentName={creatorAgentName(activeChat?.agentId || "edit")} contextNames={activeChat?.contextNames || []} disabled={streaming || changingChat || skillsChanging || !activeChat} input={input} mcpOpen={mcpOpen} onCaptureTimeline={() => void captureShot()} onCloseMcp={closeMcp} onInputChange={setInput} onOpenMcp={() => setMcpOpen((open) => !open)} onOpenSkills={() => setSkillsOpen(true)} onRemoveSkill={(skillId) => void selectSkills((skillsContext?.selected_skill_ids || []).filter((id) => id !== skillId))} onRemoveTimelineShot={() => setTimelineShot(undefined)} onSend={send} selectedSkills={selectedSkills} timelineShot={timelineShot} />
        <CreatorDrawer activeChatId={activeChatId} chats={chats} deleteDisabled={streaming || changingChat} onClose={() => setDrawerOpen(false)} onDelete={setChatToDelete} onNewChat={() => startNewChat()} onSelect={openChat} open={drawerOpen} />
        {chatToDelete && <CreatorChatDeleteDialog busy={deletingChat} name={chatToDelete.title} onCancel={() => setChatToDelete(undefined)} onConfirm={() => void deleteChat()} />}
        {skillsOpen && <CreatorSkillsModal context={skillsContext} disabled={streaming || changingChat || skillsChanging} error={skillsError} loading={skillsLoading} onClose={closeSkills} onSaved={savedSkill} onSelectedChange={(ids) => void selectSkills(ids)} />}
        {shotFlight && <TimelineShotFlight destination={shotFlight.destination} image={shotFlight.image} onFinish={finishShotFlight} source={shotFlight.source} />}
      </aside>
  );
});

function rect(value: DOMRect): ShotRect {
  return { left: value.left, top: value.top, width: value.width, height: value.height };
}
