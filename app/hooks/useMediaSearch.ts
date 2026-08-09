"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MediaAssetState, MediaSearchResult } from "../lib/mediaSearch";
import type { ProjectFile } from "../types/workspace";

const indexingConcurrency = 4;
const indexingRequestTimeout = 9 * 60_000;
const searchDelay = 200;

export function useMediaSearch(projectId: string, files: ProjectFile[], active: boolean, query: string) {
  const [states, setStates] = useState<Record<string, MediaAssetState>>({});
  const [loadedStatusKey, setLoadedStatusKey] = useState<string>();
  const [results, setResults] = useState<MediaSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  const [skipped, setSkipped] = useState<Set<string>>(() => new Set());
  const [retrying, setRetrying] = useState<Set<string>>(() => new Set());
  const indexing = useRef(new Set<string>());
  const cache = useRef(new Map<string, MediaSearchResult[]>());
  const searchableFiles = useMemo(() => files.filter((file) => !file.pending && file.objectKey && /^(video|audio|image)\//.test(file.type)), [files]);
  const assetSignature = searchableFiles.map((file) => `${file.id}:${file.generation}`).join("|");
  const statusKey = `${projectId}:${assetSignature}`;

  const loadStatus = useCallback(async () => {
    const response = await fetch(`/api/search?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" });
    const body = await response.json() as { assets?: Array<{ asset_id: string; name?: string; status: MediaAssetState["status"]; stage?: string; error?: string; updated_at?: string }>; error?: string };
    if (!response.ok || !body.assets) throw new Error(body.error || "Could not load media search index");
    return Object.fromEntries(body.assets.map((state) => [state.asset_id, { assetId: state.asset_id, name: state.name, status: state.status, stage: state.stage, error: state.error, updatedAt: state.updated_at }]));
  }, [projectId]);

  const refreshStatus = useCallback(async () => {
    setRefreshing(true);
    setError(undefined);
    try {
      setStates(await loadStatus());
      setLoadedStatusKey(statusKey);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setRefreshing(false);
    }
  }, [loadStatus, statusKey]);

  useEffect(() => {
    if (!active) return;
    let current = true;
    const timer = window.setTimeout(() => {
      setLoadedStatusKey(undefined);
      setStates(Object.fromEntries(searchableFiles.map((file) => [file.id, { assetId: file.id, name: file.name, status: "indexing" as const, stage: "Checking" }])));
      void loadStatus().then((nextStates) => {
      if (!current) return;
      setStates(nextStates);
      setLoadedStatusKey(statusKey);
      }).catch((reason) => { if (current) setError(message(reason)); });
    });
    return () => { current = false; window.clearTimeout(timer); };
  }, [active, loadStatus, searchableFiles, statusKey]);

  useEffect(() => {
    if (!active || loadedStatusKey !== statusKey) return;
    const activeIndexing = searchableFiles.filter((file) => states[file.id]?.status === "indexing").length;
    if (activeIndexing >= indexingConcurrency) return;
    const available = indexingConcurrency - activeIndexing;
    const candidates = searchableFiles.filter((file) => (states[file.id]?.status === "missing" || !states[file.id] || retrying.has(file.id)) && !indexing.current.has(file.id) && !skipped.has(file.id));
    const pending = selectPending(candidates, available, searchableFiles.some((file) => file.type.startsWith("video/") && states[file.id]?.status === "indexing"));
    const timers: number[] = [];
    for (const file of pending) {
      indexing.current.add(file.id);
      const timer = window.setTimeout(() => {
        setRetrying((current) => without(current, file.id));
        void fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "index", projectId, assetId: file.id, objectKey: file.objectKey, name: file.name, contentType: file.type, folderId: file.folderId, duration: file.duration, force: retrying.has(file.id) }),
          signal: AbortSignal.timeout(indexingRequestTimeout),
        }).then(async (response) => {
          if (!response.ok || !response.body) throw new Error(`Could not index ${file.name}`);
          cache.current.clear();
          await readIndexEvents(response.body, (event) => {
            setStates((current) => ({ ...current, [file.id]: { assetId: file.id, name: file.name, status: event.status, stage: event.stage, progress: event.progress, error: event.error, updatedAt: event.status === "ready" ? new Date().toISOString() : current[file.id]?.updatedAt } }));
          });
        }).catch((reason) => {
          const error = message(reason);
          setError(error);
          setStates((current) => ({ ...current, [file.id]: { assetId: file.id, name: file.name, status: "failed", stage: "Failed", error } }));
        }).finally(() => {
          indexing.current.delete(file.id);
        });
      });
      timers.push(timer);
    }
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [active, loadedStatusKey, projectId, retrying, searchableFiles, skipped, states, statusKey]);

  useEffect(() => {
    if (!active) return;
    const cleanQuery = query.trim().replace(/\s+/g, " ");
    if (cleanQuery.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const cacheKey = `${statusKey}:${cleanQuery}`;
      const cached = cache.current.get(cacheKey);
      if (cached) {
        setResults(cached);
        return;
      }
      setSearching(true);
      setError(undefined);
      try {
        const response = await fetch("/api/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "search", projectId, query: cleanQuery }), signal: controller.signal });
        const body = await response.json() as { results?: Array<{ moment_id: string; asset_id: string; asset_name: string; object_key: string; content_type: string; folder_id: string; thumbnail_key: string; description: string; transcript: string; start: number; end: number; score: number }>; error?: string };
        if (!response.ok || !body.results) throw new Error(body.error || "Media search failed");
        const next = body.results.map((result) => ({ momentId: result.moment_id, assetId: result.asset_id, assetName: result.asset_name, objectKey: result.object_key, contentType: result.content_type, folderId: result.folder_id, thumbnailKey: result.thumbnail_key, description: result.description, transcript: result.transcript, start: result.start, end: result.end, score: result.score }));
        cache.current.set(cacheKey, next);
        setResults(next);
      } catch (reason) {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(message(reason));
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, searchDelay);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [active, projectId, query, statusKey]);

  const retry = useCallback((assetId: string) => {
    setError(undefined);
    setRetrying((current) => new Set(current).add(assetId));
    setSkipped((current) => without(current, assetId));
    setStates((current) => ({ ...current, [assetId]: { assetId, status: "missing" } }));
  }, []);
  const failed = searchableFiles.flatMap((file) => states[file.id]?.status === "failed" && !skipped.has(file.id) && !retrying.has(file.id) ? [{ id: file.id, name: file.name, error: states[file.id].error }] : []);
  const ready = searchableFiles.filter((file) => states[file.id]?.status === "ready").length;
  const indexingCount = searchableFiles.filter((file) => states[file.id]?.status === "indexing").length;
  const skippedCount = searchableFiles.filter((file) => skipped.has(file.id)).length;
  const skipFailed = useCallback(() => setSkipped((current) => new Set([...current, ...failed.map((file) => file.id)])), [failed]);
  const retrySkipped = useCallback(() => {
    setRetrying((current) => new Set([...current, ...skipped]));
    setSkipped(new Set());
  }, [skipped]);
  return { checking: active && loadedStatusKey !== statusKey, error: active ? error : undefined, failed, indexingCount, ready, refreshStatus, refreshing, results: active && query.trim().length >= 2 ? results : [], retry, retrySkipped, searching, skipFailed, skippedCount, states, total: searchableFiles.length };
}

async function readIndexEvents(stream: ReadableStream<Uint8Array>, onEvent: (event: { status: MediaAssetState["status"]; stage: string; progress?: number; error?: string }) => void) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) if (line.trim()) onEvent(JSON.parse(line));
    if (done) break;
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer));
}

function without(values: Set<string>, value: string) {
  const next = new Set(values);
  next.delete(value);
  return next;
}

function selectPending(files: ProjectFile[], available: number, videoActive: boolean) {
  const selected: ProjectFile[] = [];
  let videoAvailable = !videoActive;
  for (const file of files) {
    if (selected.length >= available) break;
    if (file.type.startsWith("video/")) {
      if (!videoAvailable) continue;
      videoAvailable = false;
    }
    selected.push(file);
  }
  return selected;
}

function message(reason: unknown) {
  return reason instanceof Error ? reason.message : "Media search failed";
}
