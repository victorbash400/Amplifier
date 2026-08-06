"use client";

import { useCallback, useEffect, useState } from "react";
import type { ProjectFile } from "../types/workspace";
import type { TimelineClip } from "../components/timelineTypes";

export function useProjectTimeline(projectId: string, files: ProjectFile[]) {
  const [clips, setClips] = useState<TimelineClip[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const stored = localStorage.getItem(`amplifier-timeline-${projectId}`);
        if (stored) {
          const parsed = JSON.parse(stored) as Array<Omit<TimelineClip, "asset"> & { assetId: string }>;
          if (!Array.isArray(parsed)) throw new Error("The saved timeline is invalid");
          const byId = new Map(files.map((file) => [file.id, file]));
          setClips(parsed.flatMap(({ assetId, ...clip }) => {
            const asset = byId.get(assetId);
            return asset ? [{ ...clip, asset }] : [];
          }));
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

  return { clips, error, loaded, updateClips };
}
