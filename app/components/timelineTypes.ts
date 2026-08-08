import type { ProjectFile } from "../types/workspace";

export type TimelineClipRole = "visual" | "audio";
export type TimelineVisionAdjustments = { contrast?: number; colorPreset?: "red-green" | "blue-yellow" | "all-channels" };

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
  volume?: number;
  visionAdjustments?: TimelineVisionAdjustments;
};

export type CaptionCue = { id: string; start: number; end: number; text: string; brf?: string; brfTime?: string };
export type CaptionKind = "transcript" | "braille";
export type TimelineCaptionTrack = { clipId: string; cues: CaptionCue[]; large: boolean; kind: CaptionKind; downloadText?: string };
export type TimelineAudioPreview = { id: string; asset: ProjectFile; sourceTime: number; volume: number };

export type TimelinePreviewState = {
  asset?: ProjectFile;
  playing: boolean;
  sourceTime: number;
  timelineTime: number;
  timelineDuration: number;
  onSeek: (time: number) => void;
  onTogglePlayback: () => void;
  audio: TimelineAudioPreview[];
  visionAdjustments?: TimelineVisionAdjustments;
  captions?: { cues: CaptionCue[]; large: boolean; kind: CaptionKind; downloadText?: string };
};
