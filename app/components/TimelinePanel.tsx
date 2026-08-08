"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, DragEvent, PointerEvent } from "react";
import { ChevronsLeft, Magnet, Maximize2, MousePointer2, Pause, Play, Redo2, Scissors, SquarePen, Trash2, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import type { ProjectFile } from "../types/workspace";
import { useTimelineShortcuts } from "../hooks/useTimelineShortcuts";
import { collisionFreeStart } from "../lib/timelineLayout";
import { assetUrl, readMediaDuration } from "../lib/assetUploads";
import { deleteTimelineClip, moveTimelineClip, snapTimelineTime, splitTimelineClip, trimTimelineClip } from "../lib/timelineOperations";
import { TimelineClipItem, type TimelineClipHandlers } from "./TimelineClipItem";
import { TimelineModeSwitcher, type TimelineMode } from "./TimelineModeSwitcher";
import { TimelineAccessibilityTools, type HearingToolAction, type VisionColorPreset, type VisionToolAction } from "./TimelineAccessibilityTools";
import type { AslSource } from "./TimelineAslSourcePicker";
import { TimelineClipVolumeControl } from "./TimelineClipVolumeControl";
import { TimelineHorizontalScrollbar } from "./TimelineHorizontalScrollbar";
import { TimelineRuler, formatTimecode } from "./TimelineRuler";
import { TimelineTrackHeaders } from "./TimelineTrackHeaders";
import { buildTimelineTracks, firstEmptyTrackLane, type TimelineTrack, type TimelineTrackCounts } from "./timelineTracks";
import type { TimelineAslTrack, TimelineCaptionTrack, TimelineClip } from "./timelineTypes";
import styles from "./TimelinePanel.module.css";
import type { CreatorAgentId } from "./creatorAgentTypes";

const baseDuration = 20;
const trailingRoom = 8;

type TimelinePanelProps = {
  aslTrack?: TimelineAslTrack;
  captionTrack?: TimelineCaptionTrack;
  clips: TimelineClip[];
  error?: string;
  files: ProjectFile[];
  onClipsChange: (clips: TimelineClip[]) => void;
  onAskAgent: (agentId: CreatorAgentId, contextNames: string[]) => void;
  onAslChange: (track?: TimelineAslTrack) => void;
  onCaptionsChange: (captions?: TimelineCaptionTrack) => void;
  onFilesChange: (files: ProjectFile[]) => void;
  onPlayingChange: (playing: boolean) => void;
  onTimeChange: (time: number) => void;
  onTrackCountsChange: (counts: TimelineTrackCounts) => void;
  playing: boolean;
  time: number;
  trackCounts: TimelineTrackCounts;
};

export function TimelinePanel({ aslTrack, captionTrack, clips, error, files, onAskAgent, onAslChange, onCaptionsChange, onClipsChange, onFilesChange, onPlayingChange, onTimeChange, onTrackCountsChange, playing, time, trackCounts }: TimelinePanelProps) {
  const canvasRef = useRef<HTMLElement>(null);
  const viewportRef = useRef<HTMLElement>(null);
  const dragOffset = useRef(0);
  const editSnapshot = useRef<TimelineClip[] | undefined>(undefined);
  const editChanged = useRef(false);
  const undoStack = useRef<TimelineClip[][]>([]);
  const redoStack = useRef<TimelineClip[][]>([]);
  const metadataRequests = useRef(new Set<string>());
  const playbackTime = useRef(time);
  const [selectedId, setSelectedId] = useState<string>();
  const [scale, setScale] = useState(1);
  const [snapping, setSnapping] = useState(true);
  const [dropError, setDropError] = useState<string>();
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);
  const [dropActive, setDropActive] = useState(false);
  const [editingTracks, setEditingTracks] = useState<TimelineTrack[]>();
  const [divider, setDivider] = useState(50);
  const [mode, setMode] = useState<TimelineMode>("edit");
  const [visionWorking, setVisionWorking] = useState<VisionToolAction>();
  const [hearingWorking, setHearingWorking] = useState<HearingToolAction>();
  const [visionClipId, setVisionClipId] = useState<string>();
  const [visionError, setVisionError] = useState<string>();
  const timelineDuration = Math.max(baseDuration, ...clips.map((clip) => clip.start + clip.duration + trailingRoom));
  const contentDuration = Math.max(0, ...clips.map((clip) => clip.start + clip.duration));
  const tracks = editingTracks ?? buildTimelineTracks(clips, dropActive, clips, trackCounts);
  const selectedClip = clips.find((clip) => clip.id === selectedId);
  const selectedGroup = selectedClip?.linkId ? clips.filter((clip) => clip.linkId === selectedClip.linkId) : selectedClip ? [selectedClip] : [];
  const selectedHasVisual = selectedGroup.some((clip) => clip.role === "visual");
  const selectedHasAudio = selectedGroup.some((clip) => clip.role === "audio");
  const selectedHearingMedia = selectedGroup.some((clip) => clip.asset.type.startsWith("audio/") || clip.asset.type.startsWith("video/"));
  const modeClipSelected = mode === "vision" || mode === "vision-cognitive" ? selectedHasVisual : mode === "hearing" || mode === "hearing-cognitive" ? selectedHasAudio : Boolean(selectedClip);
  const modeLabel = mode === "vision-cognitive" ? "Vision + Cognitive" : mode === "hearing-cognitive" ? "Hearing + Cognitive" : mode === "deafblind-cognitive" ? "Deafblind + Cognitive" : `${mode.charAt(0).toUpperCase()}${mode.slice(1)}`;

  useEffect(() => { playbackTime.current = time; }, [time]);

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
        commit([...clips, { id: crypto.randomUUID(), asset, start: collisionStart, duration, lane: visualLane, sourceDuration: duration, trimStart: 0, role: "visual" }]);
        return;
      }
      const linkId = crypto.randomUUID();
      const audioLane = tracks.some((track) => track.role === "audio" && track.lane === visualLane) ? visualLane : firstEmptyTrackLane(clips, "audio");
      keepTrack("audio", audioLane);
      const collisionStart = collisionFreeStart(clips, start, [{ lane: visualLane, role: "visual", offset: 0, duration }, { lane: audioLane, role: "audio", offset: 0, duration }]);
      commit([...clips, { id: crypto.randomUUID(), asset, start: collisionStart, duration, lane: visualLane, sourceDuration: duration, trimStart: 0, role: "visual", linkId }, { id: crypto.randomUUID(), asset, start: collisionStart, duration, lane: audioLane, sourceDuration: duration, trimStart: 0, role: "audio", linkId }]);
      return;
    }
    const role = asset.type.startsWith("audio/") ? "audio" : "visual";
    const targetLane = laneAt(event.clientY, role);
    keepTrack(role, targetLane);
    const collisionStart = collisionFreeStart(clips, start, [{ lane: targetLane, role, offset: 0, duration }]);
    commit([...clips, { id: crypto.randomUUID(), asset, start: collisionStart, duration, lane: targetLane, sourceDuration: duration, trimStart: 0, role }]);
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
      const attachedTranscript = source === "transcript" && captionTrack?.clipId === visual.id && captionTrack.kind === "transcript" ? captionTrack.cues : undefined;
      const sourceAssetId = visual.asset.accessibilitySourceId ?? visual.asset.id;
      const sourceAsset = files.find((file) => file.id === sourceAssetId) ?? visual.asset;
      const response = await fetch("/api/hearing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, source, cues: attachedTranscript, projectId: visual.asset.projectId, assetId: sourceAssetId, sourceObjectKey: sourceAsset.objectKey, start: visual.trimStart, end: visual.trimStart + visual.duration }) });
      const body = await response.json() as { cues?: TimelineAslTrack["cues"]; error?: string };
      if (!response.ok || !body.cues?.length) throw new Error(body.error || "Could not generate ASL interpretation");
      onAslChange({ clipId: visual.id, cues: body.cues, placement: { x: 1, y: 1 } });
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

  useTimelineShortcuts({ onDelete: deleteSelected, onDeselect: () => setSelectedId(undefined), onFit: fitTimeline, onRedo: redo, onSeek: (change) => onTimeChange(Math.max(0, Math.min(contentDuration, time + change))), onSetPlaying: onPlayingChange, onSplit: splitSelected, onTogglePlayback: () => onPlayingChange(!playing), onToggleSnapping: () => setSnapping((value) => !value), onUndo: undo, onZoom: (change) => setScale((value) => Math.max(1, Math.min(8, value + change))) });

  const clipHandlers: TimelineClipHandlers = { onBeginEdit: beginEdit, onEndEdit: finishEdit, onMove: moveClip, onSelect: setSelectedId, onTrim: trimClip };

  return (
    <section className={styles.timeline} aria-label="Timeline">
      <header data-mode={mode}>
        <section className={styles.toolGroup}>
          <strong>{modeLabel}</strong>
          <button aria-label={`Ask ${modeLabel} Agent`} className={styles.askAgent} onClick={() => onAskAgent(mode, selectedClip ? [selectedClip.asset.name] : [])} title={`Ask ${modeLabel} Agent`} type="button"><SquarePen size={15} /></button>
          {mode !== "edit" && <button aria-label="Delete selected clip" disabled={!selectedId || Boolean(visionWorking || hearingWorking)} onClick={() => deleteSelected()} title="Delete selected clip" type="button"><Trash2 size={15} /></button>}
          {mode !== "edit" ? <TimelineAccessibilityTools clipSelected={mode === "hearing" ? selectedHearingMedia : modeClipSelected} mode={mode} noiseReduction={selectedClip?.asset.noiseReduction} onContrastChange={mode === "vision" ? setClipContrast : undefined} onHearingAction={mode === "hearing" ? (action, source) => void runHearingTool(action, source) : undefined} onNoiseReduction={mode === "hearing" ? (value) => void runNoiseReduction(value) : undefined} onVisionAction={mode === "vision" ? (action, preset) => void runVisionTool(action, preset) : undefined} visionAdjustments={selectedGroup.find((clip) => clip.role === "visual")?.visionAdjustments} working={mode === "hearing" ? hearingWorking : visionWorking} /> : <nav aria-label="Timeline edit tools">
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
        <section className={styles.toolGroup} data-end>{selectedClip?.role === "audio" && <TimelineClipVolumeControl name={selectedClip.asset.name} onChange={setClipVolume} value={selectedClip.volume ?? 1} />}<nav aria-label="Timeline view"><button aria-keyshortcuts="-" aria-label="Zoom out" disabled={scale <= 1} onClick={() => setScale((value) => Math.max(1, value - 1))} type="button"><ZoomOut size={15} /></button><button aria-keyshortcuts="0" aria-label="Fit timeline" onClick={fitTimeline} type="button"><Maximize2 size={15} /></button><button aria-keyshortcuts="+" aria-label="Zoom in" disabled={scale >= 8} onClick={() => setScale((value) => Math.min(8, value + 1))} type="button"><ZoomIn size={15} /></button></nav></section>
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
                {clips.map((clip) => <TimelineClipItem clip={clip} dragOffsetRef={dragOffset} handlers={clipHandlers} key={clip.id} processing={clip.id === visionClipId} selected={clip.id === selectedId} timelineDuration={timelineDuration} />)}
                {!clips.length && <p className={styles.empty}>Drag media here</p>}
                <button aria-label="Resize video and audio track areas" className={styles.avDivider} onPointerDown={resizeDivider} onPointerMove={resizeDivider} type="button" />
                <i aria-hidden="true" className={styles.playhead} style={{ left: `${(time / timelineDuration) * 100}%` }} />
              </section>
            </section>
          </section>
        </section>
        <TimelineHorizontalScrollbar scale={scale} viewportRef={viewportRef} />
      </section>
      <TimelineModeSwitcher onChange={setMode} selected={mode} />
    </section>
  );
}

function sameClips(left: TimelineClip[], right: TimelineClip[]) {
  return left === right || left.length === right.length && left.every((clip, index) => clip === right[index] || clip.id === right[index]?.id && clip.asset.id === right[index]?.asset.id && clip.start === right[index]?.start && clip.duration === right[index]?.duration && clip.lane === right[index]?.lane && clip.trimStart === right[index]?.trimStart && clip.linkId === right[index]?.linkId && clip.volume === right[index]?.volume);
}
