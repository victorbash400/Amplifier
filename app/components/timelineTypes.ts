import type { ProjectFile } from "../types/workspace";

export type TimelineClipRole = "visual" | "audio";

export type TimelineClip = {
  id: string;
  asset: ProjectFile;
  start: number;
  duration: number;
  lane: number;
  sourceDuration: number;
  trimStart: number;
  role: TimelineClipRole;
  linkId?: string;
};

export type TimelinePreviewState = {
  asset?: ProjectFile;
  playing: boolean;
  sourceTime: number;
  timelineTime: number;
  timelineDuration: number;
  onSeek: (time: number) => void;
  onTogglePlayback: () => void;
};
