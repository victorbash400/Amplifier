import type { TimelineClip, TimelineClipRole } from "./timelineTypes";

export type TimelineTrack = { id: string; label: string; lane: number; role: TimelineClipRole; temporary?: boolean };
export type TimelineTrackCounts = { audio: number; visual: number };
export const timelineTrackHeight = 48;

export function buildTimelineTracks(clips: TimelineClip[], includeDropTracks = false, occupancyClips = clips, savedCounts?: TimelineTrackCounts): TimelineTrack[] {
  const baseVideoCount = Math.max(trackCount(clips, "visual"), savedCounts?.visual ?? 1);
  const baseAudioCount = Math.max(trackCount(clips, "audio"), savedCounts?.audio ?? 1);
  const videoCount = baseVideoCount + (includeDropTracks && tracksAreOccupied(occupancyClips, "visual", baseVideoCount) ? 1 : 0);
  const audioCount = baseAudioCount + (includeDropTracks && tracksAreOccupied(occupancyClips, "audio", baseAudioCount) ? 1 : 0);
  const videos = Array.from({ length: videoCount }, (_, index) => videoCount - index - 1).map((lane) => ({ id: `V${lane + 1}`, label: `Video ${lane + 1}`, lane, role: "visual" as const, temporary: includeDropTracks && lane === videoCount - 1 }));
  const audio = Array.from({ length: audioCount }, (_, lane) => ({ id: `A${lane + 1}`, label: `Audio ${lane + 1}`, lane, role: "audio" as const, temporary: includeDropTracks && lane === audioCount - 1 }));
  return [...videos, ...audio];
}

export function trackRow(tracks: TimelineTrack[], role: TimelineClipRole, lane: number) {
  const row = tracks.findIndex((track) => track.role === role && track.lane === lane);
  return Math.max(0, row);
}

export function trackTop(role: TimelineClipRole, lane: number) {
  return role === "visual" ? `calc(var(--av-divider) - ${(lane + 1) * timelineTrackHeight}px)` : `calc(var(--av-divider) + 8px + ${lane * timelineTrackHeight}px)`;
}

export function nearestTrack(tracks: TimelineTrack[], role: TimelineClipRole, clientY: number, top: number) {
  const requestedRow = Math.max(0, Math.min(tracks.length - 1, Math.floor((clientY - top) / timelineTrackHeight)));
  const matching = tracks.filter((track) => track.role === role);
  return matching.reduce((nearest, track) => Math.abs(tracks.indexOf(track) - requestedRow) < Math.abs(tracks.indexOf(nearest) - requestedRow) ? track : nearest);
}

export function normalizeTimelineTracks(clips: TimelineClip[]) {
  const linkedVisualLanes = new Map(clips.filter((clip) => clip.role === "visual" && clip.linkId).map((clip) => [clip.linkId!, Math.max(0, clip.lane)]));
  return clips.map((clip) => {
    if (clip.role === "visual") return { ...clip, lane: Math.max(0, clip.lane) };
    if (clip.linkId && linkedVisualLanes.has(clip.linkId)) return { ...clip, lane: linkedVisualLanes.get(clip.linkId)! };
    return { ...clip, lane: Math.max(0, clip.lane >= 2 ? clip.lane - 2 : clip.lane) };
  });
}

export function firstEmptyTrackLane(clips: TimelineClip[], role: TimelineClipRole) {
  const count = trackCount(clips, role);
  for (let lane = 0; lane < count; lane += 1) if (!clips.some((clip) => clip.role === role && clip.lane === lane)) return lane;
  return count;
}

export function trackCount(clips: TimelineClip[], role: TimelineClipRole) {
  return Math.max(1, ...clips.filter((clip) => clip.role === role).map((clip) => clip.lane + 1));
}

function tracksAreOccupied(clips: TimelineClip[], role: TimelineClipRole, count: number) {
  return Array.from({ length: count }, (_, lane) => lane).every((lane) => clips.some((clip) => clip.role === role && clip.lane === lane));
}
