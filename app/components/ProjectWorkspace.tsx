"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useProjectTimeline } from "../hooks/useProjectTimeline";
import type { AmplifierProject, ProjectFile, ProjectFolder } from "../types/workspace";
import { CreatorPanel, type CreatorPanelHandle } from "./CreatorPanel";
import { FileSidebar } from "./FileSidebar";
import { PreviewPanel } from "./PreviewPanel";
import { TimelinePanel } from "./TimelinePanel";
import { WorkspacePanelResizer } from "./WorkspacePanelResizer";
import styles from "./ProjectWorkspace.module.css";
import type { CreatorAgentId, CreatorAgentRequest } from "./creatorAgentTypes";
import type { TimelineAslTrack } from "./timelineTypes";
import { timelineDocument, type TimelineDocument } from "../lib/timelineDocument";

type ProjectWorkspaceProps = {
  project: AmplifierProject;
  assetsOpen: boolean;
  creatorOpen: boolean;
  folders: ProjectFolder[];
  files: ProjectFile[];
  onFoldersChange: (folders: ProjectFolder[]) => void;
  onFilesChange: (files: ProjectFile[]) => void;
  onOpenCreator: () => void;
};

export function ProjectWorkspace({ assetsOpen, creatorOpen, project, folders, files, onFoldersChange, onFilesChange, onOpenCreator }: ProjectWorkspaceProps) {
  const [selectedFileId, setSelectedFileId] = useState<string>();
  const [selectedFileStart, setSelectedFileStart] = useState(0);
  const [timelineTime, setTimelineTime] = useState(0);
  const [timelinePlaying, setTimelinePlaying] = useState(false);
  const [viewerShare, setViewerShare] = useState(48);
  const [timelineAgentActive, setTimelineAgentActive] = useState(false);
  const [agentTimelineMode, setAgentTimelineMode] = useState<CreatorAgentId>();
  const [agentSelectionCommand, setAgentSelectionCommand] = useState<{ clipIds: string[]; playhead: number; token: string }>();
  const [agentCommitToken, setAgentCommitToken] = useState(0);
  const [agentSelection, setAgentSelection] = useState<{ clipIds: string[]; playhead: number }>({ clipIds: [], playhead: 0 });
  const creatorRef = useRef<CreatorPanelHandle>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const selectedFile = files.find((file) => file.id === selectedFileId);
  const timeline = useProjectTimeline(project.id, files);
  const captionTrack = timeline.captionTrack;
  const aslTrack = timeline.aslTrack;
  const contentDuration = Math.max(0, ...timeline.clips.map((clip) => clip.start + clip.duration));
  const activeClip = timeline.clips.find((clip) => clip.role === "visual" && timelineTime >= clip.start && timelineTime < clip.start + clip.duration) ?? timeline.clips.find((clip) => clip.role === "audio" && timelineTime >= clip.start && timelineTime < clip.start + clip.duration);
  const activeAudio = timeline.clips.filter((clip) => clip.role === "audio" && timelineTime >= clip.start && timelineTime < clip.start + clip.duration);
  const captionClip = captionTrack && timeline.clips.find((clip) => clip.id === captionTrack.clipId);
  const captions = captionTrack && captionClip ? { large: captionTrack.large, kind: captionTrack.kind, downloadText: captionTrack.downloadText, cues: captionTrack.cues.filter((cue) => cue.end > captionClip.trimStart && cue.start < captionClip.trimStart + captionClip.duration).map((cue) => ({ ...cue, start: captionClip.start + cue.start - captionClip.trimStart, end: captionClip.start + cue.end - captionClip.trimStart })) } : undefined;
  const aslClip = aslTrack && timeline.clips.find((clip) => clip.id === aslTrack.clipId);
  const asl = aslTrack && aslClip && activeClip?.id === aslClip.id ? { cues: aslTrack.cues.filter((cue) => cue.end > aslClip.trimStart && cue.start < aslClip.trimStart + aslClip.duration).map((cue) => ({ ...cue, start: aslClip.start + cue.start - aslClip.trimStart, end: aslClip.start + cue.end - aslClip.trimStart })), placement: aslTrack.placement, onPlacementChange: (placement: TimelineAslTrack["placement"]) => timeline.setAslTrack((current) => current ? { ...current, placement } : current) } : undefined;
  const timelinePreview = { asset: activeClip?.asset, playing: timelinePlaying, sourceTime: activeClip ? activeClip.trimStart + timelineTime - activeClip.start : 0, timelineTime, timelineDuration: contentDuration, onSeek: setTimelineTime, onTogglePlayback: () => setTimelinePlaying((current) => !current), audio: activeAudio.map((clip) => ({ id: clip.id, asset: clip.asset, sourceTime: clip.trimStart + timelineTime - clip.start, volume: clip.volume ?? 1 })), captions, asl, visionAdjustments: activeClip?.role === "visual" ? activeClip.visionAdjustments : undefined };
  const layout = assetsOpen ? creatorOpen ? "both" : "assets" : creatorOpen ? "creator" : "none";
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const stored = Number(localStorage.getItem(`amplifier-workspace-viewer-share-${project.id}`));
      if (Number.isFinite(stored) && stored >= 30 && stored <= 70) setViewerShare(stored);
    });
    return () => cancelAnimationFrame(frame);
  }, [project.id]);
  function commitViewerShare(value: number) { localStorage.setItem(`amplifier-workspace-viewer-share-${project.id}`, value.toFixed(2)); }
  function askAgent(agentId: CreatorAgentId, contextNames: string[]) {
    const request: CreatorAgentRequest = { agentId, contextNames, nonce: crypto.randomUUID() };
    creatorRef.current?.requestAgent(request);
    onOpenCreator();
  }
  function openFile(file: ProjectFile, start = 0) {
    setSelectedFileId(file.id);
    setSelectedFileStart(start);
  }
  const handleAgentSelection = useCallback((clipIds: string[], playhead: number) => setAgentSelection({ clipIds, playhead }), []);
  function applyAgentResult(result: Record<string, unknown>) {
    const asset = result.asset && typeof result.asset === "object" ? result.asset as ProjectFile : undefined;
    const availableFiles = asset && !files.some((file) => file.id === asset.id) ? [...files, asset] : files;
    if (availableFiles !== files) onFilesChange(availableFiles);
    if (result.timeline && typeof result.timeline === "object") {
      const document = result.timeline as TimelineDocument;
      timeline.applyCanonical(document, availableFiles);
      if (result.change && typeof result.change === "object") setAgentCommitToken((current) => current + 1);
    }
    if (result.selection && typeof result.selection === "object") {
      const selection = result.selection as Record<string, unknown>;
      const clipIds = Array.isArray(selection.clipIds) ? selection.clipIds.filter((id): id is string => typeof id === "string") : [];
      const playhead = typeof selection.playhead === "number" ? selection.playhead : timelineTime;
      setAgentSelection({ clipIds, playhead });
      setAgentSelectionCommand({ clipIds, playhead, token: crypto.randomUUID() });
    }
  }
  const agentTimeline = timelineDocument(timeline.revision, timeline.clips, timeline.trackCounts, captionTrack, aslTrack);
  return <section className={styles.workspace} data-panel-layout={layout} ref={workspaceRef} style={{ "--viewer-share": `${viewerShare}%` } as CSSProperties}><FileSidebar files={files} folders={folders} onFilesChange={onFilesChange} onFoldersChange={onFoldersChange} onOpenFile={openFile} project={project} /><PreviewPanel selectedFile={selectedFile} selectedFileStart={selectedFileStart} timeline={timelinePreview} /><CreatorPanel files={files} hidden={!creatorOpen} onActiveAgentChange={setAgentTimelineMode} onTimelineActivityChange={setTimelineAgentActive} onToolResponse={applyAgentResult} playhead={agentSelection.playhead} projectId={project.id} ref={creatorRef} selectedClipIds={agentSelection.clipIds} timeline={agentTimeline} /><WorkspacePanelResizer containerRef={workspaceRef} onChange={setViewerShare} onCommit={commitViewerShare} value={viewerShare} /><TimelinePanel agentCommitToken={agentCommitToken} agentMode={agentTimelineMode} agentSelection={agentSelectionCommand} aslTrack={aslTrack} captionTrack={captionTrack} clips={timeline.clips} error={timeline.error} files={files} folders={folders} onAskAgent={askAgent} onAslChange={timeline.setAslTrack} onCaptionsChange={timeline.setCaptionTrack} onClipsChange={timeline.updateClips} onFilesChange={onFilesChange} onPlayingChange={setTimelinePlaying} onSelectionChange={handleAgentSelection} onTimeChange={setTimelineTime} onTrackCountsChange={timeline.updateTrackCounts} playing={timelinePlaying} time={timelineTime} timelineAgentActive={timelineAgentActive} trackCounts={timeline.trackCounts} /></section>;
}
