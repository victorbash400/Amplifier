export type TimelineLayoutClip = { id: string; lane: number; role: string; start: number; duration: number };
export type TimelinePlacement = { lane: number; role: string; offset: number; duration: number };

const epsilon = 0.001;

export function collisionFreeStart(clips: TimelineLayoutClip[], desiredStart: number, placements: TimelinePlacement[], ignoredIds: Set<string> = new Set()) {
  const blockers = clips.filter((clip) => !ignoredIds.has(clip.id));
  const candidates = [Math.max(0, desiredStart), 0];
  for (const blocker of blockers) for (const placement of placements) {
    if (!sameTrack(blocker, placement)) continue;
    candidates.push(blocker.start + blocker.duration - placement.offset, blocker.start - placement.duration - placement.offset);
  }
  const valid = candidates.filter((candidate) => candidate >= 0 && placements.every((placement) => blockers.every((blocker) => !sameTrack(blocker, placement) || !overlaps(candidate + placement.offset, placement.duration, blocker.start, blocker.duration))));
  if (valid.length) return valid.sort((a, b) => Math.abs(a - desiredStart) - Math.abs(b - desiredStart) || a - b)[0];
  return Math.max(0, ...blockers.map((clip) => clip.start + clip.duration));
}

export function previousClipEnd(clips: TimelineLayoutClip[], role: string, lane: number, before: number, ignoredIds: Set<string>) {
  return Math.max(0, ...clips.filter((clip) => clip.role === role && clip.lane === lane && !ignoredIds.has(clip.id) && clip.start + clip.duration <= before + epsilon).map((clip) => clip.start + clip.duration));
}

export function nextClipStart(clips: TimelineLayoutClip[], role: string, lane: number, after: number, ignoredIds: Set<string>) {
  return Math.min(Infinity, ...clips.filter((clip) => clip.role === role && clip.lane === lane && !ignoredIds.has(clip.id) && clip.start >= after - epsilon).map((clip) => clip.start));
}

function sameTrack(left: Pick<TimelineLayoutClip, "role" | "lane">, right: Pick<TimelinePlacement, "role" | "lane">) { return left.role === right.role && left.lane === right.lane; }

function overlaps(startA: number, durationA: number, startB: number, durationB: number) {
  return startA < startB + durationB - epsilon && startA + durationA > startB + epsilon;
}
