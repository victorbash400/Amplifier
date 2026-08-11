"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, DragEvent, PointerEvent } from "react";
import { ChevronsLeft, Download, Magnet, Maximize2, MousePointer2, Pause, Play, Redo2, Scissors, SquarePen, Trash2, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import type { ProjectFile, ProjectFolder } from "../types/workspace";
import { useTimelineShortcuts } from "../hooks/useTimelineShortcuts";
import { collisionFreeStart } from "../lib/timelineLayout";
import { assetUrl, readMediaDuration } from "../lib/assetUploads";
import { deleteTimelineClip, moveTimelineClip, snapTimelineTime, splitTimelineClip, trimTimelineClip } from "../lib/timelineOperations";
import { TimelineClipItem, type TimelineClipHandlers } from "./TimelineClipItem";
import { TimelineAgentScan } from "./TimelineAgentScan";
import { TimelineModeSwitcher, type TimelineMode } from "./TimelineModeSwitcher";
import { TimelineAccessibilityTools, type HearingToolAction, type VisionColorPreset, type VisionToolAction } from "./TimelineAccessibilityTools";
import type { SensoryToolAction } from "./TimelineAccessibilityTools";
import type { AslSource } from "./TimelineAslSourcePicker";
import { TimelineClipVolumeControl } from "./TimelineClipVolumeControl";
import { TimelineHorizontalScrollbar } from "./TimelineHorizontalScrollbar";
import { TimelineExportModal } from "./TimelineExportModal";
import { TimelineLanguageTools, type LanguageAction } from "./TimelineLanguageTools";
import { TimelineRuler, formatTimecode } from "./TimelineRuler";
import { TimelineTrackHeaders } from "./TimelineTrackHeaders";
import { buildTimelineTracks, firstEmptyTrackLane, type TimelineTrack, type TimelineTrackCounts } from "./timelineTracks";
import type { TimelineAslTrack, TimelineCaptionTrack, TimelineClip } from "./timelineTypes";
import styles from "./TimelinePanel.module.css";
import type { CreatorAgentId } from "./creatorAgentTypes";

const baseDuration = 20;
const trailingRoom = 8;

type TimelinePanelProps = {
  agentMode?: CreatorAgentId;
  agentSelection?: { clipIds: string[]; playhead: number; token: string };
  timelineAgentActive?: boolean;
  agentCommitToken?: number;
  aslTrack?: TimelineAslTrack;
  captionTrack?: TimelineCaptionTrack;
  clips: TimelineClip[];
  error?: string;
  files: ProjectFile[];
  folders: ProjectFolder[];
  onClipsChange: (clips: TimelineClip[]) => void;
  onAskAgent: (agentId: CreatorAgentId, contextNames: string[]) => void;
  onAslChange: (track?: TimelineAslTrack) => void;
  onCaptionsChange: (captions?: TimelineCaptionTrack) => void;
  onFilesChange: (files: ProjectFile[]) => void;
  onPlayingChange: (playing: boolean) => void;
  onSelectionChange?: (clipIds: string[], playhead: number) => void;
  onTimeChange: (time: number) => void;
  onTrackCountsChange: (counts: TimelineTrackCounts) => void;
  playing: boolean;
  time: number;
  trackCounts: TimelineTrackCounts;
};

export function TimelinePanel({ agentCommitToken = 0, agentMode, agentSelection, aslTrack, captionTrack, clips, error, files, folders, onAskAgent, onAslChange, onCaptionsChange, onClipsChange, onFilesChange, onPlayingChange, onSelectionChange, onTimeChange, onTrackCountsChange, playing, time, timelineAgentActive = false, trackCounts }: TimelinePanelProps) {
  const canvasRef = useRef<HTMLElement>(null);
  const viewportRef = useRef<HTMLElement>(null);
  const dragOffset = useRef(0);
  const editSnapshot = useRef<TimelineClip[] | undefined>(undefined);
  const editChanged = useRef(false);
  const undoStack = useRef<TimelineClip[][]>([]);
  const redoStack = useRef<TimelineClip[][]>([]);
  const previousClips = useRef(clips);
  const previousAgentCommitToken = useRef(agentCommitToken);
  const metadataRequests = useRef(new Set<string>());
  const playbackTime = useRef(time);
  const [selectedId, setSelectedId] = useState<string>();
  const [scale, setScale] = useState(1);
  const [snapping, setSnapping] = useState(true);
  const [dropError, setDropError] = useState<string>();
  const [exportError, setExportError] = useState<string>();
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);
  const [dropActive, setDropActive] = useState(false);
  const [editingTracks, setEditingTracks] = useState<TimelineTrack[]>();
  const [divider, setDivider] = useState(50);
  const [mode, setMode] = useState<TimelineMode>("edit");
  const [visionWorking, setVisionWorking] = useState<VisionToolAction>();
  const [hearingWorking, setHearingWorking] = useState<HearingToolAction>();
  const [sensoryWorking, setSensoryWorking] = useState<SensoryToolAction>();
  const [languageWorking, setLanguageWorking] = useState<LanguageAction>();
  const [visionClipId, setVisionClipId] = useState<string>();
  const [visionError, setVisionError] = useState<string>();
  const timelineDuration = Math.max(baseDuration, ...clips.map((clip) => clip.start + clip.duration + trailingRoom));
  const contentDuration = Math.max(0, ...clips.map((clip) => clip.start + clip.duration));
  const tracks = editingTracks ?? buildTimelineTracks(clips, dropActive, clips, trackCounts);
  const activeMode = agentMode ?? mode;
  const selectedClip = clips.find((clip) => clip.id === selectedId);
  const selectedGroup = selectedClip?.linkId ? clips.filter((clip) => clip.linkId === selectedClip.linkId) : selectedClip ? [selectedClip] : [];
  const selectedHasVisual = selectedGroup.some((clip) => clip.role === "visual");
  const selectedHasAudio = selectedGroup.some((clip) => clip.role === "audio");
  const selectedHearingMedia = selectedGroup.some((clip) => clip.asset.type.startsWith("audio/") || clip.asset.type.startsWith("video/"));
  const modeClipSelected = activeMode === "vision" || activeMode === "sensory" ? selectedHasVisual : activeMode === "hearing" ? selectedHasAudio : Boolean(selectedClip);
  const modeLabel = `${activeMode.charAt(0).toUpperCase()}${activeMode.slice(1)}`;
  const agentLabel = activeMode === "edit" ? "Agent" : `${modeLabel} Agent`;

  useEffect(() => { playbackTime.current = time; }, [time]);
  useEffect(() => {
    if (!agentSelection) return;
    const frame = requestAnimationFrame(() => {
      setSelectedId(agentSelection.clipIds[0]);
      onTimeChange(agentSelection.playhead);
    });
    return () => cancelAnimationFrame(frame);
  }, [agentSelection, onTimeChange]);
  useEffect(() => { onSelectionChange?.(selectedId ? [selectedId] : [], time); }, [onSelectionChange, selectedId, time]);
  useEffect(() => {
    let frame = 0;
    if (agentCommitToken !== previousAgentCommitToken.current) {
      undoStack.current.push(previousClips.current);
      redoStack.current = [];
      previousAgentCommitToken.current = agentCommitToken;
      frame = requestAnimationFrame(() => { setUndoCount(undoStack.current.length); setRedoCount(0); });
    }
    previousClips.current = clips;
    return () => cancelAnimationFrame(frame);
  }, [agentCommitToken, clips]);

  useEffect(() => {
    const missing = files.filter((file) => !file.pending && (file.type.startsWith("video/") || file.type.startsWith("audio/")) && !(file.duration && file.duration > 0) && !metadataRequests.current.has(file.id));
    if (!missing.length) return;
    missing.forEach((file) => metadataRequests.current.add(file.id));
    void Promise.all(missing.map(async (file) => {
      try { return [file.id, await readMediaDuration(assetUrl(file), file.type)] as const; }
      catch { metadataRequests.current.delete(file.id); return undefined; }
    })).then((results) => {
      const durations = new Map(results.filter((result): result is readonly [string, number] => Boolean(result)));
      if (durations.size) onFilesChange(files.map((file) => durations.has(file.id) ? { ...file, duration: durations.get(file.id) } : file));
    });
  }, [files, onFilesChange]);

  useEffect(() => {
    if (!playing || !contentDuration) return;
    let frame = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      const next = playbackTime.current + (now - previous) / 1000;
      previous = now;
      playbackTime.current = next >= contentDuration ? 0 : next;
      onTimeChange(playbackTime.current);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [contentDuration, onTimeChange, playing]);

  function commit(next: TimelineClip[]) {
    undoStack.current.push(clips);
    redoStack.current = [];
    setUndoCount(undoStack.current.length);
    setRedoCount(0);
    onClipsChange(next);
  }

  function commitDroppedClips(next: TimelineClip[], selectedId: string, start: number) {
    commit(next);
    setSelectedId(selectedId);
    onPlayingChange(false);
    onTimeChange(start);
  }

  async function exportTimeline(name: string, folderId: string) {
    setExporting(true);
    setExportError(undefined);
    try {
      if (clips.some((clip) => !clip.asset.objectKey)) throw new Error("Every timeline clip must be uploaded before export");
      const response = await fetch("/api/timelines/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: clips[0].asset.projectId, folderId, name, clips: clips.map((clip) => ({ assetId: clip.asset.id, objectKey: clip.asset.objectKey, name: clip.asset.name, contentType: clip.asset.type, start: clip.start, duration: clip.duration, sourceDuration: clip.sourceDuration, trimStart: clip.trimStart, lane: clip.lane, role: clip.role, volume: clip.volume ?? 1, contrast: clip.visionAdjustments?.contrast ?? 1, colorPreset: clip.visionAdjustments?.colorPreset })) }) });
      const body = await response.json() as { asset?: ProjectFile; error?: string };
      if (!response.ok || !body.asset) throw new Error(body.error || "Timeline export failed");
      onFilesChange([...files, body.asset]);
      setExportOpen(false);
    } catch (reason) {
      setExportError(reason instanceof Error ? reason.message : "Timeline export failed");
    } finally {
      setExporting(false);
    }
  }

  function timeAt(clientX: number) {
    const rect = canvasRef.current?.getBoundingClientRect();
    return rect ? Math.max(0, Math.min(timelineDuration, ((clientX - rect.left) / rect.width) * timelineDuration)) : 0;
  }

  function laneAt(clientY: number, role: "visual" | "audio") {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const dividerY = rect.top + rect.height * divider / 100;
    const requested = role === "visual" ? Math.floor((dividerY - clientY) / 48) : Math.floor((clientY - dividerY - 8) / 48);
    const matching = tracks.filter((track) => track.role === role);
    return Math.max(0, Math.min(matching.length - 1, requested));
  }

  function keepTrack(role: "visual" | "audio", lane: number) {
    const next = { ...trackCounts, [role]: Math.max(trackCounts[role], lane + 1) };
    if (next.audio !== trackCounts.audio || next.visual !== trackCounts.visual) onTrackCountsChange(next);
  }

  function snap(value: number, movingId?: string) {
    return snapping ? snapTimelineTime(clips, value, time, movingId) : value;
  }

  async function dropAsset(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDropActive(false);
    setDropError(undefined);
    const asset = files.find((file) => file.id === event.dataTransfer.getData("application/x-amplifier-asset"));
    if (!asset || asset.pending) return;
    const timedMedia = asset.type.startsWith("video/") || asset.type.startsWith("audio/");
    let duration = asset.duration;
    if (timedMedia && !(duration && duration > 0)) {
      try {
        duration = await readMediaDuration(assetUrl(asset), asset.type);
        onFilesChange(files.map((item) => item.id === asset.id ? { ...item, duration } : item));
      } catch (reason) {
        setDropError(reason instanceof Error ? reason.message : "Could not read media duration");
        return;
      }
    }
    if (!(duration && duration > 0)) duration = 5;
    const start = snap(timeAt(event.clientX));
    const visualLane = laneAt(event.clientY, "visual");
    keepTrack("visual", visualLane);
    if (asset.type.startsWith("video/")) {
      if (asset.hasAudio === false && asset.audioProbe === "ffprobe") {
        const collisionStart = collisionFreeStart(clips, start, [{ lane: visualLane, role: "visual", offset: 0, duration }]);
        const clipId = crypto.randomUUID();
        commitDroppedClips([...clips, { id: clipId, asset, start: collisionStart, duration, lane: visualLane, sourceDuration: duration, trimStart: 0, role: "visual" }], clipId, collisionStart);
        return;
      }
      const linkId = crypto.randomUUID();
      const visualId = crypto.randomUUID();
      const audioLane = tracks.some((track) => track.role === "audio" && track.lane === visualLane) ? visualLane : firstEmptyTrackLane(clips, "audio");
      keepTrack("audio", audioLane);
      const collisionStart = collisionFreeStart(clips, start, [{ lane: visualLane, role: "visual", offset: 0, duration }, { lane: audioLane, role: "audio", offset: 0, duration }]);
      commitDroppedClips([...clips, { id: visualId, asset, start: collisionStart, duration, lane: visualLane, sourceDuration: duration, trimStart: 0, role: "visual", linkId }, { id: crypto.randomUUID(), asset, start: collisionStart, duration, lane: audioLane, sourceDuration: duration, trimStart: 0, role: "audio", linkId }], visualId, collisionStart);
      return;
    }
    const role = asset.type.startsWith("audio/") ? "audio" : "visual";
    const targetLane = laneAt(event.clientY, role);
    keepTrack(role, targetLane);
    const collisionStart = collisionFreeStart(clips, start, [{ lane: targetLane, role, offset: 0, duration }]);
    const clipId = crypto.randomUUID();
    commitDroppedClips([...clips, { id: clipId, asset, start: collisionStart, duration, lane: targetLane, sourceDuration: duration, trimStart: 0, role }], clipId, collisionStart);
  }

  function moveClip(id: string, clientX: number, clientY: number) {
    const moving = clips.find((clip) => clip.id === id);
    if (!moving) return;
    const desiredStart = Math.max(0, Math.min(timelineDuration - .25, snap(timeAt(clientX) - dragOffset.current, id)));
    const targetLane = laneAt(clientY, moving.role);
    keepTrack(moving.role, targetLane);
    const linked = moving.linkId ? clips.filter((clip) => clip.linkId === moving.linkId) : [];
    const movingIds = new Set(linked.map((clip) => clip.id));
    const targetLanes = linked.length ? Object.fromEntries(["visual", "audio"].map((role) => {
      if (role === moving.role) return [role, targetLane];
      const matchingTrackExists = tracks.some((track) => track.role === role && track.lane === targetLane);
      return [role, matchingTrackExists ? targetLane : firstEmptyTrackLane(clips.filter((clip) => !movingIds.has(clip.id)), role as "visual" | "audio")];
    })) : undefined;
    const next = moveTimelineClip(clips, id, desiredStart, targetLane, targetLanes);
    if (!sameClips(next, clips)) { editChanged.current = true; onClipsChange(next); }
  }

  function trimClip(id: string, edge: "start" | "end", clientX: number) {
    const next = trimTimelineClip(clips, id, edge, snap(timeAt(clientX), id));
    if (!sameClips(next, clips)) { editChanged.current = true; onClipsChange(next); }
  }

  function splitSelected() {
    if (!selectedId) return;
    commit(splitTimelineClip(clips, selectedId, time, () => crypto.randomUUID()));
  }

  function deleteSelected(ripple = false) {
    if (!selectedId) return;
    commit(deleteTimelineClip(clips, selectedId, ripple));
    setSelectedId(undefined);
  }

  function undo() {
    const previous = undoStack.current.pop();
    if (!previous) return;
    redoStack.current.push(clips);
    onClipsChange(previous);
    setSelectedId(undefined);
    setUndoCount(undoStack.current.length);
    setRedoCount(redoStack.current.length);
  }

  function redo() {
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push(clips);
    onClipsChange(next);
    setSelectedId(undefined);
    setUndoCount(undoStack.current.length);
    setRedoCount(redoStack.current.length);
  }

  function fitTimeline() {
    setScale(1);
    requestAnimationFrame(() => viewportRef.current?.scrollTo({ left: 0 }));
  }

  function beginEdit(kind: "move" | "trim", id: string) {
    if (kind === "move") {
      const moving = clips.find((clip) => clip.id === id);
      const movingIds = new Set(clips.filter((clip) => clip.id === id || Boolean(moving?.linkId && clip.linkId === moving.linkId)).map((clip) => clip.id));
      setEditingTracks(buildTimelineTracks(clips, true, clips.filter((clip) => !movingIds.has(clip.id)), trackCounts));
    }
    editSnapshot.current = clips;
    editChanged.current = false;
  }

  function finishEdit() {
    setEditingTracks(undefined);
    if (editChanged.current && editSnapshot.current) {
      undoStack.current.push(editSnapshot.current);
      redoStack.current = [];
      setUndoCount(undoStack.current.length);
      setRedoCount(0);
    }
    editSnapshot.current = undefined;
    editChanged.current = false;
  }

  function startScrub(event: PointerEvent<HTMLElement>) {
    if (event.target !== event.currentTarget) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    onPlayingChange(false);
    onTimeChange(Math.min(contentDuration, timeAt(event.clientX)));
  }

  function scrub(event: PointerEvent<HTMLElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) onTimeChange(Math.min(contentDuration, timeAt(event.clientX)));
  }

  function resizeDivider(event: PointerEvent<HTMLButtonElement>) {
    if (event.type === "pointerdown") event.currentTarget.setPointerCapture(event.pointerId);
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (rect) setDivider(Math.max(25, Math.min(75, ((event.clientY - rect.top) / rect.height) * 100)));
  }

  function setClipVolume(value: number) {
    if (!selectedClip || selectedClip.role !== "audio") return;
    onClipsChange(clips.map((clip) => clip.id === selectedClip.id ? { ...clip, volume: value } : clip));
  }

  function setClipContrast(value: number) {
    const visual = selectedGroup.find((clip) => clip.role === "visual");
    if (!visual) return;
    const contrast = Math.abs(value - 1) < .01 ? undefined : value;
    const visionAdjustments = { ...visual.visionAdjustments, contrast };
    onClipsChange(clips.map((clip) => clip.id === visual.id ? { ...clip, visionAdjustments } : clip));
  }

  async function runVisionTool(action: VisionToolAction, preset?: VisionColorPreset) {
    const visual = selectedGroup.find((clip) => clip.role === "visual");
    if (!visual) return;
    if (action === "color-safe") {
      const visionAdjustments = { ...visual.visionAdjustments, colorPreset: preset };
      commit(clips.map((clip) => clip.id === visual.id ? { ...clip, visionAdjustments } : clip));
      return;
    }
    setVisionError(undefined);
    setVisionWorking(action);
    setVisionClipId(visual.id);
    try {
      if ((action === "transcript" || action === "braille") && captionTrack?.clipId === visual.id && captionTrack.kind === action) {
        onCaptionsChange(undefined);
        return;
      }
      if (action === "larger-text" && captionTrack?.clipId === visual.id) {
        onCaptionsChange({ ...captionTrack, large: action === "larger-text" ? !captionTrack.large : captionTrack.large });
        return;
      }
      if (action === "transcript" || action === "braille" || action === "larger-text") {
        const kind = action === "braille" ? "braille" : "transcript";
        const sourceAssetId = visual.asset.accessibilitySourceId ?? visual.asset.id;
        const sourceAsset = files.find((file) => file.id === sourceAssetId) ?? visual.asset;
        const response = await fetch("/api/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: kind, projectId: visual.asset.projectId, assetId: sourceAssetId, objectKey: sourceAsset.objectKey }) });
        const body = await response.json() as { cues?: TimelineCaptionTrack["cues"]; brf?: string; error?: string };
        if (!response.ok || !body.cues) throw new Error(body.error || "Could not load transcript");
        onCaptionsChange({ clipId: visual.id, cues: body.cues, large: action === "larger-text", kind, downloadText: body.brf });
        return;
      }
      const assetId = crypto.randomUUID();
      const response = await fetch("/api/vision", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, projectId: visual.asset.projectId, assetId, sourceAssetId: visual.asset.id, folderId: visual.asset.folderId, start: visual.trimStart, end: visual.trimStart + visual.duration }) });
      const body = await response.json() as { asset?: ProjectFile; error?: string };
      if (!response.ok || !body.asset?.duration) throw new Error(body.error || "Could not generate narration");
      const lane = firstEmptyTrackLane(clips, "audio");
      keepTrack("audio", lane);
      onFilesChange([...files, body.asset]);
      commit([...clips, { id: crypto.randomUUID(), asset: body.asset, start: visual.start, duration: body.asset.duration, lane, sourceDuration: body.asset.duration, trimStart: 0, role: "audio", volume: 1 }]);
    } catch (reason) {
      setVisionError(reason instanceof Error ? reason.message : "Vision tool failed");
    } finally {
      setVisionWorking(undefined);
      setVisionClipId(undefined);
    }
  }

  async function runHearingTool(action: HearingToolAction, source?: AslSource) {
    const target = selectedGroup.find((clip) => clip.role === "visual") ?? selectedGroup.find((clip) => clip.role === "audio");
    if (!target || action === "noise-reduce") return;
    setVisionError(undefined);
    setHearingWorking(action);
    setVisionClipId(target.id);
    try {
      if (action === "captions" || action === "transcript") {
        if (captionTrack?.clipId === target.id && captionTrack.kind === action) {
          onCaptionsChange(undefined);
          return;
        }
        const sourceAssetId = target.asset.accessibilitySourceId ?? target.asset.id;
        const sourceAsset = files.find((file) => file.id === sourceAssetId) ?? target.asset;
        const response = await fetch("/api/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "transcript", projectId: target.asset.projectId, assetId: sourceAssetId, objectKey: sourceAsset.objectKey }) });
        const body = await response.json() as { cues?: TimelineCaptionTrack["cues"]; error?: string };
        if (!response.ok || !body.cues?.length) throw new Error(body.error || "Could not load transcript");
        onCaptionsChange({ clipId: target.id, cues: body.cues, large: false, kind: action });
        return;
      }
      const visual = selectedGroup.find((clip) => clip.role === "visual");
      if (!visual || action !== "asl" || !source) return;
      if (aslTrack?.clipId === visual.id) {
        onAslChange(undefined);
        return;
      }
      const attachedCaptions = source === "captions" && captionTrack?.clipId === visual.id && captionTrack.kind === "captions" ? captionTrack.cues : undefined;
      const sourceAssetId = visual.asset.accessibilitySourceId ?? visual.asset.id;
      const sourceAsset = files.find((file) => file.id === sourceAssetId) ?? visual.asset;
      const response = await fetch("/api/hearing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, source, cues: attachedCaptions, projectId: visual.asset.projectId, assetId: sourceAssetId, sourceObjectKey: sourceAsset.objectKey, start: visual.trimStart, end: visual.trimStart + visual.duration }) });
      const body = await response.json() as { cues?: TimelineAslTrack["cues"]; error?: string };
      if (!response.ok || !body.cues?.length) throw new Error(body.error || "Could not generate ASL interpretation");
      onAslChange({ clipId: visual.id, cues: body.cues, placement: { x: .88, y: .12 } });
    } catch (reason) {
      setVisionError(reason instanceof Error ? reason.message : "ASL generation failed");
    } finally {
      setHearingWorking(undefined);
      setVisionClipId(undefined);
    }
  }

  async function runNoiseReduction(strength: number) {
    const target = selectedGroup.find((clip) => clip.role === "audio") ?? selectedGroup.find((clip) => clip.role === "visual");
    if (!target) return;
    const sourceAssetId = target.asset.accessibilitySourceId ?? target.asset.id;
    const sourceAsset = files.find((file) => file.id === sourceAssetId) ?? target.asset;
    if (!sourceAsset.objectKey) return setVisionError("The selected clip is not uploaded");
    setVisionError(undefined);
    setHearingWorking("noise-reduce");
    setVisionClipId(target.id);
    try {
      const response = await fetch("/api/hearing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "noise-reduce", projectId: target.asset.projectId, assetId: crypto.randomUUID(), sourceAssetId, sourceObjectKey: sourceAsset.objectKey, sourceName: sourceAsset.name, contentType: sourceAsset.type, folderId: target.asset.folderId, duration: target.asset.duration, strength }) });
      const body = await response.json() as { asset?: ProjectFile; error?: string };
      if (!response.ok || !body.asset) throw new Error(body.error || "Could not reduce background noise");
      onFilesChange([...files, body.asset]);
      commit(clips.map((clip) => clip.id === target.id ? { ...clip, asset: body.asset as ProjectFile } : clip));
    } catch (reason) {
      setVisionError(reason instanceof Error ? reason.message : "Noise reduction failed");
    } finally {
      setHearingWorking(undefined);
      setVisionClipId(undefined);
    }
  }

  async function runSensoryTool(action: SensoryToolAction) {
    const visual = selectedGroup.find((clip) => clip.role === "visual");
    if (visual && !visual.asset.type.startsWith("video/")) return setVisionError("Sensory remaking requires a video clip");
    if (!visual?.asset.objectKey) return setVisionError("The selected video is not uploaded");
    setVisionError(undefined);
    setSensoryWorking(action);
    setVisionClipId(visual.id);
    try {
      const assetId = crypto.randomUUID();
      const response = await fetch("/api/sensory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, projectId: visual.asset.projectId, assetId, sourceAssetId: visual.asset.accessibilitySourceId ?? visual.asset.id, sourceObjectKey: visual.asset.objectKey, sourceName: visual.asset.name, folderId: visual.asset.folderId, start: visual.trimStart, end: visual.trimStart + visual.duration }) });
      const body = await response.json() as { asset?: ProjectFile; error?: string };
      if (!response.ok || !body.asset?.duration) throw new Error(body.error || "Could not create sensory-safe video");
      const lane = firstEmptyTrackLane(clips, "visual");
      keepTrack("visual", lane);
      onFilesChange([...files, body.asset]);
      commit([...clips, { id: crypto.randomUUID(), asset: body.asset, start: visual.start, duration: visual.duration, lane, sourceDuration: body.asset.duration, trimStart: 0, role: "visual" }]);
    } catch (reason) {
      setVisionError(reason instanceof Error ? reason.message : "Sensory video generation failed");
    } finally {
      setSensoryWorking(undefined);
      setVisionClipId(undefined);
    }
  }

  async function runLanguageTool(action: LanguageAction, language: string) {
    const target = selectedGroup.find((clip) => clip.role === "visual") ?? selectedGroup.find((clip) => clip.role === "audio");
    if (!target) return;
    const sourceAssetId = target.asset.accessibilitySourceId ?? target.asset.id;
    const sourceAsset = files.find((file) => file.id === sourceAssetId) ?? target.asset;
    if (!sourceAsset.objectKey) return setVisionError("The selected clip is not uploaded");
    setVisionError(undefined);
    setLanguageWorking(action);
    setVisionClipId(target.id);
    try {
      const response = await fetch("/api/language", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, language, projectId: target.asset.projectId, assetId: crypto.randomUUID(), sourceAssetId, sourceObjectKey: sourceAsset.objectKey, sourceGeneration: sourceAsset.generation, sourceDuration: sourceAsset.duration, sourceName: sourceAsset.name, folderId: target.asset.folderId, start: target.trimStart, end: target.trimStart + target.duration }) });
      const body = await response.json() as { asset?: ProjectFile; cues?: TimelineCaptionTrack["cues"]; error?: string };
      if (!response.ok) throw new Error(body.error || "Could not create language track");
      if (action === "captions") {
        if (!body.cues?.length) throw new Error("Translation returned no captions");
        onCaptionsChange({ clipId: target.id, cues: body.cues, large: false, kind: "captions" });
        return;
      }
      if (!body.asset?.duration) throw new Error("Translation returned no audio");
      const lane = firstEmptyTrackLane(clips, "audio");
      keepTrack("audio", lane);
      onFilesChange([...files, body.asset]);
      const next = action === "audio" ? clips.map((clip) => clip.role === "audio" && (clip.id === target.id || Boolean(target.linkId && clip.linkId === target.linkId)) ? { ...clip, volume: 0 } : clip) : clips;
      commit([...next, { id: crypto.randomUUID(), asset: body.asset, start: target.start, duration: body.asset.duration, lane, sourceDuration: body.asset.duration, trimStart: 0, role: "audio", volume: 1 }]);
    } catch (reason) {
      setVisionError(reason instanceof Error ? reason.message : "Language generation failed");
    } finally {
      setLanguageWorking(undefined);
      setVisionClipId(undefined);
    }
  }

  useTimelineShortcuts({ onDelete: deleteSelected, onDeselect: () => setSelectedId(undefined), onFit: fitTimeline, onRedo: redo, onSeek: (change) => onTimeChange(Math.max(0, Math.min(contentDuration, time + change))), onSetPlaying: onPlayingChange, onSplit: splitSelected, onTogglePlayback: () => onPlayingChange(!playing), onToggleSnapping: () => setSnapping((value) => !value), onUndo: undo, onZoom: (change) => setScale((value) => Math.max(1, Math.min(8, value + change))) });

  const clipHandlers: TimelineClipHandlers = { onBeginEdit: beginEdit, onEndEdit: finishEdit, onMove: moveClip, onSelect: setSelectedId, onTrim: trimClip };

  return (
    <section className={styles.timeline} aria-label="Timeline">
      <header data-mode={activeMode}>
        <section className={styles.toolGroup}>
          <strong>{modeLabel}</strong>
          <button aria-label={`Ask ${agentLabel}`} className={styles.askAgent} onClick={() => onAskAgent(activeMode, selectedClip ? [selectedClip.asset.name] : [])} title={`Ask ${agentLabel}`} type="button"><SquarePen size={15} /><span>{agentLabel}</span></button>
          {activeMode === "language" ? <TimelineLanguageTools clipSelected={Boolean(selectedClip)} onAction={(action, language) => void runLanguageTool(action, language)} working={languageWorking} /> : activeMode !== "edit" ? <TimelineAccessibilityTools clipSelected={activeMode === "hearing" ? selectedHearingMedia : modeClipSelected} mode={activeMode} noiseReduction={selectedClip?.asset.noiseReduction} onContrastChange={activeMode === "vision" ? setClipContrast : undefined} onHearingAction={activeMode === "hearing" ? (action, source) => void runHearingTool(action, source) : undefined} onNoiseReduction={activeMode === "hearing" ? (value) => void runNoiseReduction(value) : undefined} onSensoryAction={activeMode === "sensory" ? (action) => void runSensoryTool(action) : undefined} onVisionAction={activeMode === "vision" ? (action, preset) => void runVisionTool(action, preset) : undefined} visionAdjustments={selectedGroup.find((clip) => clip.role === "visual")?.visionAdjustments} working={activeMode === "hearing" ? hearingWorking : activeMode === "sensory" ? sensoryWorking : visionWorking} /> : <nav aria-label="Timeline edit tools">
            <button aria-label="Select" type="button"><MousePointer2 size={15} /></button>
            <button aria-keyshortcuts="Meta+Z Control+Z" aria-label="Undo" disabled={!undoCount} onClick={undo} type="button"><Undo2 size={15} /></button>
            <button aria-keyshortcuts="Meta+Shift+Z Control+Shift+Z" aria-label="Redo" disabled={!redoCount} onClick={redo} type="button"><Redo2 size={15} /></button>
            <button aria-keyshortcuts="S" aria-label="Split at playhead" disabled={!selectedId} onClick={splitSelected} type="button"><Scissors size={15} /></button>
            <button aria-keyshortcuts="Delete Backspace" aria-label="Delete selected clip" disabled={!selectedId} onClick={() => deleteSelected()} type="button"><Trash2 size={15} /></button>
            <button aria-keyshortcuts="Shift+Delete Shift+Backspace" aria-label="Ripple delete selected clip" disabled={!selectedId} onClick={() => deleteSelected(true)} type="button"><ChevronsLeft size={15} /></button>
            <button aria-keyshortcuts="N" aria-label={`${snapping ? "Disable" : "Enable"} snapping`} aria-pressed={snapping} onClick={() => setSnapping((value) => !value)} type="button"><Magnet size={15} /></button>
          </nav>}
        </section>
        <section className={styles.playback}><button aria-keyshortcuts="Space" aria-label={playing ? "Pause" : "Play"} onClick={() => onPlayingChange(!playing)} type="button">{playing ? <Pause size={16} /> : <Play size={16} />}</button><time>{formatTimecode(time)}</time></section>
        <section className={styles.toolGroup} data-end>{activeMode !== "edit" && <button aria-label="Delete selected clip" disabled={!selectedId || Boolean(visionWorking || hearingWorking || sensoryWorking)} onClick={() => deleteSelected()} title="Delete selected clip" type="button"><Trash2 size={15} /></button>}{selectedClip?.role === "audio" && <TimelineClipVolumeControl name={selectedClip.asset.name} onChange={setClipVolume} value={selectedClip.volume ?? 1} />}<nav aria-label="Timeline view"><button aria-keyshortcuts="-" aria-label="Zoom out" disabled={scale <= 1} onClick={() => setScale((value) => Math.max(1, value - 1))} type="button"><ZoomOut size={15} /></button><button aria-keyshortcuts="0" aria-label="Fit timeline" onClick={fitTimeline} type="button"><Maximize2 size={15} /></button><button aria-keyshortcuts="+" aria-label="Zoom in" disabled={scale >= 8} onClick={() => setScale((value) => Math.min(8, value + 1))} type="button"><ZoomIn size={15} /></button></nav><button aria-label="Export timeline as MP4" disabled={!clips.length || exporting} onClick={() => { setExportError(undefined); setExportOpen(true); }} title="Export timeline as MP4" type="button"><Download size={15} /></button></section>
      </header>
      <section className={styles.composition}>
        {(dropError || visionError || error) && <p className={styles.dropError} role="alert">{dropError || visionError || error}</p>}
        <section className={styles.trackLayout} style={{ "--av-divider": `${divider}%`, "--track-count": tracks.length } as CSSProperties}>
          <time className={styles.timelineTimecode}>{formatTimecode(time)}</time>
          <TimelineTrackHeaders clips={clips} tracks={tracks} />
          <section className={styles.viewport} ref={viewportRef}>
            <section className={styles.timelineCanvas} style={{ "--timeline-scale": scale } as CSSProperties}>
              <TimelineRuler duration={timelineDuration} scale={scale} />
              <section aria-label="Editable timeline" className={styles.canvas} onDragEnter={() => setDropActive(true)} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropActive(false); }} onDragOver={(event) => event.preventDefault()} onDrop={dropAsset} onPointerDown={startScrub} onPointerMove={scrub} ref={canvasRef}>
                <TimelineAgentScan active={timelineAgentActive} />
                {clips.map((clip) => <TimelineClipItem clip={clip} dragOffsetRef={dragOffset} handlers={clipHandlers} key={clip.id} processing={clip.id === visionClipId} selected={clip.id === selectedId} timelineDuration={timelineDuration} />)}
                <button aria-label="Resize video and audio track areas" className={styles.avDivider} onPointerDown={resizeDivider} onPointerMove={resizeDivider} type="button" />
                <i aria-hidden="true" className={styles.playhead} style={{ left: `${(time / timelineDuration) * 100}%` }} />
              </section>
            </section>
          </section>
        </section>
        <TimelineHorizontalScrollbar scale={scale} viewportRef={viewportRef} />
      </section>
      <TimelineModeSwitcher onChange={setMode} selected={activeMode} />
      {exportOpen && <TimelineExportModal busy={exporting} error={exportError} folders={folders} initialName="Untitled timeline" onCancel={() => setExportOpen(false)} onSave={(name, folderId) => void exportTimeline(name, folderId)} />}
    </section>
  );
}

function sameClips(left: TimelineClip[], right: TimelineClip[]) {
  return left === right || left.length === right.length && left.every((clip, index) => clip === right[index] || clip.id === right[index]?.id && clip.asset.id === right[index]?.asset.id && clip.start === right[index]?.start && clip.duration === right[index]?.duration && clip.lane === right[index]?.lane && clip.trimStart === right[index]?.trimStart && clip.linkId === right[index]?.linkId && clip.volume === right[index]?.volume);
}
