"use client";

import { useCallback, useEffect, useState } from "react";
import type { ProjectFile } from "../types/workspace";
import type { TimelineClip } from "../components/timelineTypes";
import { normalizeTimelineTracks, type TimelineTrackCounts } from "../components/timelineTracks";

export function useProjectTimeline(projectId: string, files: ProjectFile[]) {
  const [clips, setClips] = useState<TimelineClip[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string>();
  const [trackCounts, setTrackCounts] = useState<TimelineTrackCounts>({ audio: 1, visual: 1 });

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const stored = localStorage.getItem(`amplifier-timeline-${projectId}`);
        if (stored) {
          const parsed = JSON.parse(stored) as Array<Omit<TimelineClip, "asset"> & { assetId: string }>;
          if (!Array.isArray(parsed)) throw new Error("The saved timeline is invalid");
          const byId = new Map(files.map((file) => [file.id, file]));
          setClips(normalizeTimelineTracks(parsed.flatMap(({ assetId, ...clip }) => {
            const asset = byId.get(assetId);
            if (!asset) return [];
            const sourceDuration = asset.duration && (asset.type.startsWith("video/") || asset.type.startsWith("audio/")) ? asset.duration : clip.sourceDuration;
            return [{ ...clip, asset, sourceDuration }];
          })));
        }
        const storedTracks = localStorage.getItem(`amplifier-timeline-tracks-${projectId}`);
        if (storedTracks) {
          const parsedTracks = JSON.parse(storedTracks) as TimelineTrackCounts;
          if (Number.isInteger(parsedTracks.audio) && parsedTracks.audio > 0 && Number.isInteger(parsedTracks.visual) && parsedTracks.visual > 0) setTrackCounts(parsedTracks);
        }
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Could not load timeline");
      } finally {
        setLoaded(true);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [files, projectId]);

  const updateClips = useCallback((next: TimelineClip[] | ((current: TimelineClip[]) => TimelineClip[])) => {
    setClips((current) => {
      const updated = typeof next === "function" ? next(current) : next;
      try {
        localStorage.setItem(`amplifier-timeline-${projectId}`, JSON.stringify(updated.map(({ asset, ...clip }) => ({ ...clip, assetId: asset.id }))));
        setError(undefined);
        return updated;
      } catch {
        setError("Could not save timeline");
        return current;
      }
    });
  }, [projectId]);

  const updateTrackCounts = useCallback((next: TimelineTrackCounts) => {
    localStorage.setItem(`amplifier-timeline-tracks-${projectId}`, JSON.stringify(next));
    setTrackCounts(next);
  }, [projectId]);

  return { clips, error, loaded, trackCounts, updateClips, updateTrackCounts };
}
