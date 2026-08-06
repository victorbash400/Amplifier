export type TimelineLayoutClip = { id: string; lane: number; start: number; duration: number };
export type TimelinePlacement = { lane: number; offset: number; duration: number };

const epsilon = 0.001;

export function collisionFreeStart(clips: TimelineLayoutClip[], desiredStart: number, placements: TimelinePlacement[], ignoredIds: Set<string> = new Set()) {
  const blockers = clips.filter((clip) => !ignoredIds.has(clip.id));
  const candidates = [Math.max(0, desiredStart), 0];
  for (const blocker of blockers) for (const placement of placements) {
    if (blocker.lane !== placement.lane) continue;
    candidates.push(blocker.start + blocker.duration - placement.offset, blocker.start - placement.duration - placement.offset);
  }
  const valid = candidates.filter((candidate) => candidate >= 0 && placements.every((placement) => blockers.every((blocker) => blocker.lane !== placement.lane || !overlaps(candidate + placement.offset, placement.duration, blocker.start, blocker.duration))));
  if (valid.length) return valid.sort((a, b) => Math.abs(a - desiredStart) - Math.abs(b - desiredStart) || a - b)[0];
  return Math.max(0, ...blockers.map((clip) => clip.start + clip.duration));
}

export function previousClipEnd(clips: TimelineLayoutClip[], lane: number, before: number, ignoredIds: Set<string>) {
  return Math.max(0, ...clips.filter((clip) => clip.lane === lane && !ignoredIds.has(clip.id) && clip.start + clip.duration <= before + epsilon).map((clip) => clip.start + clip.duration));
}

export function nextClipStart(clips: TimelineLayoutClip[], lane: number, after: number, ignoredIds: Set<string>) {
  return Math.min(Infinity, ...clips.filter((clip) => clip.lane === lane && !ignoredIds.has(clip.id) && clip.start >= after - epsilon).map((clip) => clip.start));
}

function overlaps(startA: number, durationA: number, startB: number, durationB: number) {
  return startA < startB + durationB - epsilon && startA + durationA > startB + epsilon;
}
