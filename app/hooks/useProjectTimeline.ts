"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectFile } from "../types/workspace";
import type { TimelineAslTrack, TimelineCaptionTrack, TimelineClip } from "../components/timelineTypes";
import { normalizeTimelineTracks, type TimelineTrackCounts } from "../components/timelineTracks";
import { hydrateTimeline, timelineDocument, type TimelineDocument } from "../lib/timelineDocument";

export function useProjectTimeline(projectId: string, files: ProjectFile[]) {
  const [clips, setClips] = useState<TimelineClip[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string>();
  const [trackCounts, setTrackCounts] = useState<TimelineTrackCounts>({ audio: 1, visual: 1 });
  const [revision, setRevision] = useState(0);
  const [captionTrack, setCaptionTrack] = useState<TimelineCaptionTrack>();
  const [aslTrack, setAslTrack] = useState<TimelineAslTrack>();
  const revisionRef = useRef(0);
  const filesRef = useRef(files);
  const lastSavedRef = useRef("");
  const saveQueueRef = useRef(Promise.resolve());

  useEffect(() => { filesRef.current = files; }, [files]);

  useEffect(() => {
    const controller = new AbortController();
    const frame = requestAnimationFrame(() => {
      void (async () => {
      try {
        const response = await fetch(`/api/timelines?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store", signal: controller.signal });
        const document = await response.json() as TimelineDocument & { error?: string };
        if (!response.ok) throw new Error(document.error || "Could not load timeline");
        setClips(normalizeTimelineTracks(hydrateTimeline(document, filesRef.current)));
        setTrackCounts(document.trackCounts);
        setRevision(document.revision);
        revisionRef.current = document.revision;
        setCaptionTrack(document.captionTrack ?? undefined);
        setAslTrack(document.aslTrack ?? undefined);
        lastSavedRef.current = comparable(document);
      } catch (reason) {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : "Could not load timeline");
      } finally {
        setLoaded(true);
      }
      })();
    });
    return () => { cancelAnimationFrame(frame); controller.abort(); };
  }, [projectId]);

  useEffect(() => {
    if (!loaded) return;
    const snapshot = timelineDocument(revisionRef.current, clips, trackCounts, captionTrack, aslTrack);
    const encoded = comparable(snapshot);
    if (encoded === lastSavedRef.current) return;
    lastSavedRef.current = encoded;
    saveQueueRef.current = saveQueueRef.current.then(async () => {
      const expectedRevision = revisionRef.current;
      const response = await fetch("/api/timelines", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, expectedRevision, timeline: { ...snapshot, revision: expectedRevision } }) });
      const document = await response.json() as TimelineDocument & { error?: string; detail?: string | { message?: string } };
      if (!response.ok) {
        lastSavedRef.current = "";
        const detail = typeof document.detail === "string" ? document.detail : document.detail?.message;
        setError(detail || document.error || "Could not save timeline");
        return;
      }
      revisionRef.current = document.revision;
      setRevision(document.revision);
      lastSavedRef.current = comparable(document);
      setError(undefined);
    }).catch((reason) => {
      lastSavedRef.current = "";
      setError(reason instanceof Error ? reason.message : "Could not save timeline");
    });
  }, [aslTrack, captionTrack, clips, loaded, projectId, trackCounts]);

  const updateClips = useCallback((next: TimelineClip[] | ((current: TimelineClip[]) => TimelineClip[])) => {
    setError(undefined);
    setClips((current) => typeof next === "function" ? next(current) : next);
  }, []);

  const updateTrackCounts = useCallback((next: TimelineTrackCounts) => {
    setTrackCounts(next);
  }, []);

  const applyCanonical = useCallback((document: TimelineDocument, availableFiles: ProjectFile[] = files) => {
    setClips(normalizeTimelineTracks(hydrateTimeline(document, availableFiles)));
    setTrackCounts(document.trackCounts);
    setRevision(document.revision);
    revisionRef.current = document.revision;
    setCaptionTrack(document.captionTrack ?? undefined);
    setAslTrack(document.aslTrack ?? undefined);
    lastSavedRef.current = comparable(document);
    setError(undefined);
  }, [files]);

  return { applyCanonical, aslTrack, captionTrack, clips, error, loaded, revision, setAslTrack, setCaptionTrack, trackCounts, updateClips, updateTrackCounts };
}

function comparable(document: TimelineDocument) {
  return JSON.stringify({ clips: document.clips, trackCounts: document.trackCounts, captionTrack: document.captionTrack ?? null, aslTrack: document.aslTrack ?? null });
}
