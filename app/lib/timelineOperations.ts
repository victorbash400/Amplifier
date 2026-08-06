import { collisionFreeStart, nextClipStart, previousClipEnd } from "./timelineLayout";

export type EditableTimelineClip = { id: string; lane: number; start: number; duration: number; sourceDuration: number; trimStart: number; linkId?: string };
const minimumDuration = 0.25;

export function moveTimelineClip<T extends EditableTimelineClip>(clips: T[], id: string, desiredStart: number, targetLane: number, maximumLane: number) {
  const moving = clips.find((clip) => clip.id === id);
  if (!moving) return clips;
  const linked = moving.linkId ? clips.filter((clip) => clip.linkId === moving.linkId) : [moving];
  const requestedLaneChange = targetLane - moving.lane;
  const lowestLane = Math.min(...linked.map((clip) => clip.lane + requestedLaneChange));
  let laneChange = requestedLaneChange - Math.min(0, lowestLane);
  const highestLane = Math.max(...linked.map((clip) => clip.lane + laneChange));
  laneChange -= Math.max(0, highestLane - maximumLane);
  const movingIds = new Set(linked.map((clip) => clip.id));
  const placements = linked.map((clip) => ({ lane: clip.lane + laneChange, offset: clip.start - moving.start, duration: clip.duration }));
  const start = collisionFreeStart(clips, Math.max(0, desiredStart), placements, movingIds);
  return clips.map((clip) => movingIds.has(clip.id) ? { ...clip, start: Math.max(0, start + clip.start - moving.start), lane: clip.lane + laneChange } : clip);
}

export function splitTimelineClip<T extends EditableTimelineClip>(clips: T[], id: string, playhead: number, createId: () => string) {
  const selected = clips.find((clip) => clip.id === id);
  if (!selected || playhead <= selected.start || playhead >= selected.start + selected.duration) return clips;
  const splitLinkId = selected.linkId ? createId() : undefined;
  return clips.flatMap((clip) => {
    if (clip.id !== selected.id && (!selected.linkId || clip.linkId !== selected.linkId)) return [clip];
    const leftDuration = playhead - clip.start;
    return [{ ...clip, duration: leftDuration }, { ...clip, id: createId(), linkId: splitLinkId, start: playhead, duration: clip.duration - leftDuration, trimStart: clip.trimStart + leftDuration }];
  });
}

export function trimTimelineClip<T extends EditableTimelineClip>(clips: T[], id: string, edge: "start" | "end", time: number) {
  const edited = clips.find((clip) => clip.id === id);
  if (!edited) return clips;
  const group = edited.linkId ? clips.filter((clip) => clip.linkId === edited.linkId) : [edited];
  const groupIds = new Set(group.map((clip) => clip.id));
  return clips.map((clip) => {
    if (!groupIds.has(clip.id)) return clip;
    if (edge === "start") {
      const earliest = Math.max(clip.start - clip.trimStart, previousClipEnd(clips, clip.lane, clip.start, groupIds));
      const start = Math.max(earliest, Math.min(time, clip.start + clip.duration - minimumDuration));
      const change = start - clip.start;
      return { ...clip, start, duration: clip.duration - change, trimStart: clip.trimStart + change };
    }
    const nextStart = nextClipStart(clips, clip.lane, clip.start + clip.duration, groupIds);
    return { ...clip, duration: Math.min(clip.sourceDuration - clip.trimStart, Math.max(minimumDuration, nextStart - clip.start), Math.max(minimumDuration, time - clip.start)) };
  });
}

export function deleteTimelineClip<T extends EditableTimelineClip>(clips: T[], id: string, ripple = false) {
  const selected = clips.find((clip) => clip.id === id);
  if (!selected) return clips;
  const removedIds = new Set(clips.filter((clip) => clip.id === selected.id || Boolean(selected.linkId && clip.linkId === selected.linkId)).map((clip) => clip.id));
  const cutEnd = selected.start + selected.duration;
  return clips.filter((clip) => !removedIds.has(clip.id)).map((clip) => ripple && clip.start >= cutEnd ? { ...clip, start: Math.max(selected.start, clip.start - selected.duration) } : clip);
}

export function snapTimelineTime(clips: EditableTimelineClip[], time: number, playhead: number, movingId?: string, threshold = 0.15) {
  const moving = movingId ? clips.find((clip) => clip.id === movingId) : undefined;
  const movingIds = new Set(moving?.linkId ? clips.filter((clip) => clip.linkId === moving.linkId).map((clip) => clip.id) : movingId ? [movingId] : []);
  const points = [0, playhead, ...clips.filter((clip) => !movingIds.has(clip.id)).flatMap((clip) => [clip.start, clip.start + clip.duration])];
  const nearest = points.reduce((best, point) => Math.abs(point - time) < Math.abs(best - time) ? point : best, points[0]);
  return Math.abs(nearest - time) <= threshold ? nearest : time;
}
