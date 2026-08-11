import type { TimelineCaptionTrack, TimelineClip } from "../components/timelineTypes";

export type TimelineExportCaption = { id: string; start: number; end: number; text: string };

export function timelineExportCaptions(track: TimelineCaptionTrack | undefined, clips: TimelineClip[], include: boolean): TimelineExportCaption[] | undefined {
  if (!include || track?.kind !== "captions") return undefined;
  const clip = clips.find((item) => item.id === track.clipId);
  if (!clip) return undefined;
  return track.cues.flatMap((cue) => {
    if (cue.end <= clip.trimStart || cue.start >= clip.trimStart + clip.duration) return [];
    const start = Math.max(clip.start, clip.start + cue.start - clip.trimStart);
    const end = Math.min(clip.start + clip.duration, clip.start + cue.end - clip.trimStart);
    return end > start ? [{ id: cue.id, text: cue.text, start, end }] : [];
  });
}
