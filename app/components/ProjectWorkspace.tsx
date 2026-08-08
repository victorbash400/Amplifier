"use client";

import { useRef, useState } from "react";
import { useProjectTimeline } from "../hooks/useProjectTimeline";
import type { AmplifierProject, ProjectFile, ProjectFolder } from "../types/workspace";
import { CreatorPanel, type CreatorPanelHandle } from "./CreatorPanel";
import { FileSidebar } from "./FileSidebar";
import { PreviewPanel } from "./PreviewPanel";
import { TimelinePanel } from "./TimelinePanel";
import styles from "./ProjectWorkspace.module.css";
import type { CreatorAgentId, CreatorAgentRequest } from "./creatorAgentTypes";
import type { TimelineCaptionTrack } from "./timelineTypes";

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
  const [captionTrack, setCaptionTrack] = useState<TimelineCaptionTrack>();
  const creatorRef = useRef<CreatorPanelHandle>(null);
  const selectedFile = files.find((file) => file.id === selectedFileId);
  const timeline = useProjectTimeline(project.id, files);
  const contentDuration = Math.max(0, ...timeline.clips.map((clip) => clip.start + clip.duration));
  const activeClip = timeline.clips.find((clip) => clip.role === "visual" && timelineTime >= clip.start && timelineTime < clip.start + clip.duration) ?? timeline.clips.find((clip) => clip.role === "audio" && timelineTime >= clip.start && timelineTime < clip.start + clip.duration);
  const activeAudio = timeline.clips.filter((clip) => clip.role === "audio" && timelineTime >= clip.start && timelineTime < clip.start + clip.duration);
  const captionClip = captionTrack && timeline.clips.find((clip) => clip.id === captionTrack.clipId);
  const captions = captionTrack && captionClip ? { large: captionTrack.large, kind: captionTrack.kind, downloadText: captionTrack.downloadText, cues: captionTrack.cues.filter((cue) => cue.end > captionClip.trimStart && cue.start < captionClip.trimStart + captionClip.duration).map((cue) => ({ ...cue, start: captionClip.start + cue.start - captionClip.trimStart, end: captionClip.start + cue.end - captionClip.trimStart })) } : undefined;
  const timelinePreview = { asset: activeClip?.asset, playing: timelinePlaying, sourceTime: activeClip ? activeClip.trimStart + timelineTime - activeClip.start : 0, timelineTime, timelineDuration: contentDuration, onSeek: setTimelineTime, onTogglePlayback: () => setTimelinePlaying((current) => !current), audio: activeAudio.map((clip) => ({ id: clip.id, asset: clip.asset, sourceTime: clip.trimStart + timelineTime - clip.start, volume: clip.volume ?? 1 })), captions, visionAdjustments: activeClip?.role === "visual" ? activeClip.visionAdjustments : undefined };
  const layout = assetsOpen ? creatorOpen ? "both" : "assets" : creatorOpen ? "creator" : "none";
  function askAgent(agentId: CreatorAgentId, contextNames: string[]) {
    const request: CreatorAgentRequest = { agentId, contextNames, nonce: crypto.randomUUID() };
    creatorRef.current?.requestAgent(request);
    onOpenCreator();
  }
  function openFile(file: ProjectFile, start = 0) {
    setSelectedFileId(file.id);
    setSelectedFileStart(start);
  }
  return <section className={styles.workspace} data-panel-layout={layout}>{assetsOpen && <FileSidebar files={files} folders={folders} onFilesChange={onFilesChange} onFoldersChange={onFoldersChange} onOpenFile={openFile} project={project} />}<PreviewPanel selectedFile={selectedFile} selectedFileStart={selectedFileStart} timeline={timelinePreview} /><CreatorPanel hidden={!creatorOpen} projectId={project.id} ref={creatorRef} /><TimelinePanel captionTrack={captionTrack} clips={timeline.clips} error={timeline.error} files={files} onAskAgent={askAgent} onCaptionsChange={setCaptionTrack} onClipsChange={timeline.updateClips} onFilesChange={onFilesChange} onPlayingChange={setTimelinePlaying} onTimeChange={setTimelineTime} onTrackCountsChange={timeline.updateTrackCounts} playing={timelinePlaying} time={timelineTime} trackCounts={timeline.trackCounts} /></section>;
}
