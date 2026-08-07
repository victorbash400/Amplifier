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
  const [timelineTime, setTimelineTime] = useState(0);
  const [timelinePlaying, setTimelinePlaying] = useState(false);
  const creatorRef = useRef<CreatorPanelHandle>(null);
  const selectedFile = files.find((file) => file.id === selectedFileId);
  const timeline = useProjectTimeline(project.id, files);
  const contentDuration = Math.max(0, ...timeline.clips.map((clip) => clip.start + clip.duration));
  const activeClip = timeline.clips.find((clip) => clip.role === "visual" && timelineTime >= clip.start && timelineTime < clip.start + clip.duration) ?? timeline.clips.find((clip) => clip.role === "audio" && timelineTime >= clip.start && timelineTime < clip.start + clip.duration);
  const timelinePreview = { asset: activeClip?.asset, playing: timelinePlaying, sourceTime: activeClip ? activeClip.trimStart + timelineTime - activeClip.start : 0, timelineTime, timelineDuration: contentDuration, onSeek: setTimelineTime, onTogglePlayback: () => setTimelinePlaying((current) => !current) };
  const layout = assetsOpen ? creatorOpen ? "both" : "assets" : creatorOpen ? "creator" : "none";
  function askAgent(agentId: CreatorAgentId, contextNames: string[]) {
    const request: CreatorAgentRequest = { agentId, contextNames, nonce: crypto.randomUUID() };
    creatorRef.current?.requestAgent(request);
    onOpenCreator();
  }
  return <section className={styles.workspace} data-panel-layout={layout}>{assetsOpen && <FileSidebar files={files} folders={folders} onFilesChange={onFilesChange} onFoldersChange={onFoldersChange} onOpenFile={(file) => setSelectedFileId(file.id)} project={project} />}<PreviewPanel selectedFile={selectedFile} timeline={timelinePreview} /><CreatorPanel hidden={!creatorOpen} projectId={project.id} ref={creatorRef} /><TimelinePanel clips={timeline.clips} error={timeline.error} files={files} onAskAgent={askAgent} onClipsChange={timeline.updateClips} onFilesChange={onFilesChange} onPlayingChange={setTimelinePlaying} onTimeChange={setTimelineTime} onTrackCountsChange={timeline.updateTrackCounts} playing={timelinePlaying} time={timelineTime} trackCounts={timeline.trackCounts} /></section>;
}
