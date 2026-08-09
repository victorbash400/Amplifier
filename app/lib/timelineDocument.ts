import type { TimelineTrackCounts } from "../components/timelineTracks";
import type { TimelineAslTrack, TimelineCaptionTrack, TimelineClip } from "../components/timelineTypes";
import type { ProjectFile } from "../types/workspace";

export type StoredTimelineClip = Omit<TimelineClip, "asset"> & { assetId: string };
export type TimelineDocument = {
  revision: number;
  clips: StoredTimelineClip[];
  trackCounts: TimelineTrackCounts;
  captionTrack?: TimelineCaptionTrack;
  aslTrack?: TimelineAslTrack;
};

export function timelineDocument(revision: number, clips: TimelineClip[], trackCounts: TimelineTrackCounts, captionTrack?: TimelineCaptionTrack, aslTrack?: TimelineAslTrack): TimelineDocument {
  return { revision, clips: clips.map(({ asset, ...clip }) => ({ ...clip, assetId: asset.id })), trackCounts, captionTrack, aslTrack };
}

export function hydrateTimeline(document: TimelineDocument, files: ProjectFile[]) {
  const assets = new Map(files.map((file) => [file.id, file]));
  return document.clips.flatMap(({ assetId, ...clip }) => {
    const asset = assets.get(assetId);
    return asset ? [{ ...clip, asset }] : [];
  });
}
