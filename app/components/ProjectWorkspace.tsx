"use client";

import { useState } from "react";
import { useProjectTimeline } from "../hooks/useProjectTimeline";
import type { AmplifierProject, ProjectFile, ProjectFolder } from "../types/workspace";
import { CreatorPanel } from "./CreatorPanel";
import { FileSidebar } from "./FileSidebar";
import { PreviewPanel } from "./PreviewPanel";
import { TimelinePanel } from "./TimelinePanel";
import styles from "./ProjectWorkspace.module.css";

type ProjectWorkspaceProps = {
  project: AmplifierProject;
  assetsOpen: boolean;
  creatorOpen: boolean;
  folders: ProjectFolder[];
  files: ProjectFile[];
  onFoldersChange: (folders: ProjectFolder[]) => void;
  onFilesChange: (files: ProjectFile[]) => void;
};

export function ProjectWorkspace({ assetsOpen, creatorOpen, project, folders, files, onFoldersChange, onFilesChange }: ProjectWorkspaceProps) {
  const [selectedFileId, setSelectedFileId] = useState<string>();
  const [timelineTime, setTimelineTime] = useState(0);
  const [timelinePlaying, setTimelinePlaying] = useState(false);
  const selectedFile = files.find((file) => file.id === selectedFileId);
  const timeline = useProjectTimeline(project.id, files);
  const contentDuration = Math.max(0, ...timeline.clips.map((clip) => clip.start + clip.duration));
  const activeClip = timeline.clips.find((clip) => clip.role === "visual" && timelineTime >= clip.start && timelineTime < clip.start + clip.duration) ?? timeline.clips.find((clip) => clip.role === "audio" && timelineTime >= clip.start && timelineTime < clip.start + clip.duration);
  const timelinePreview = { asset: activeClip?.asset, playing: timelinePlaying, sourceTime: activeClip ? activeClip.trimStart + timelineTime - activeClip.start : 0, timelineTime, timelineDuration: contentDuration, onSeek: setTimelineTime, onTogglePlayback: () => setTimelinePlaying((current) => !current) };
  const layout = assetsOpen ? creatorOpen ? "both" : "assets" : creatorOpen ? "creator" : "none";
  return <section className={styles.workspace} data-panel-layout={layout}>{assetsOpen && <FileSidebar files={files} folders={folders} onFilesChange={onFilesChange} onFoldersChange={onFoldersChange} onOpenFile={(file) => setSelectedFileId(file.id)} project={project} />}<PreviewPanel selectedFile={selectedFile} timeline={timelinePreview} />{creatorOpen && <CreatorPanel projectId={project.id} />}<TimelinePanel clips={timeline.clips} error={timeline.error} files={files} onClipsChange={timeline.updateClips} onPlayingChange={setTimelinePlaying} onTimeChange={setTimelineTime} playing={timelinePlaying} time={timelineTime} /></section>;
}
