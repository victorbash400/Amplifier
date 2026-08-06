"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, DragEvent, PointerEvent } from "react";
import { ChevronsLeft, Magnet, Maximize2, MousePointer2, Pause, Play, Redo2, Scissors, Trash2, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import type { ProjectFile } from "../types/workspace";
import { useTimelineShortcuts } from "../hooks/useTimelineShortcuts";
import { collisionFreeStart } from "../lib/timelineLayout";
import { deleteTimelineClip, moveTimelineClip, snapTimelineTime, splitTimelineClip, trimTimelineClip } from "../lib/timelineOperations";
import { TimelineClipItem, type TimelineClipHandlers } from "./TimelineClipItem";
import { TimelineModeSwitcher } from "./TimelineModeSwitcher";
import type { TimelineClip } from "./timelineTypes";
import styles from "./TimelinePanel.module.css";

const baseDuration = 20;
const trailingRoom = 8;

type TimelinePanelProps = {
  clips: TimelineClip[];
  error?: string;
  files: ProjectFile[];
  onClipsChange: (clips: TimelineClip[]) => void;
  onPlayingChange: (playing: boolean) => void;
  onTimeChange: (time: number) => void;
  playing: boolean;
  time: number;
};

export function TimelinePanel({ clips, error, files, onClipsChange, onPlayingChange, onTimeChange, playing, time }: TimelinePanelProps) {
  const canvasRef = useRef<HTMLElement>(null);
  const viewportRef = useRef<HTMLElement>(null);
  const dragOffset = useRef(0);
  const editSnapshot = useRef<TimelineClip[] | undefined>(undefined);
  const editChanged = useRef(false);
  const undoStack = useRef<TimelineClip[][]>([]);
  const redoStack = useRef<TimelineClip[][]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [scale, setScale] = useState(1);
  const [snapping, setSnapping] = useState(true);
  const [dropError, setDropError] = useState<string>();
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);
  const timelineDuration = Math.max(baseDuration, ...clips.map((clip) => clip.start + clip.duration + trailingRoom));
  const contentDuration = Math.max(0, ...clips.map((clip) => clip.start + clip.duration));

  useEffect(() => {
    if (!playing || !contentDuration) return;
    let frame = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      if (now - previous >= 1000 / 30) {
        const next = time + (now - previous) / 1000;
        previous = now;
        onTimeChange(next >= contentDuration ? 0 : next);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [contentDuration, onTimeChange, playing, time]);

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

  function laneAt(clientY: number) {
    const rect = canvasRef.current?.getBoundingClientRect();
    return rect ? Math.max(0, Math.min(4, Math.round((clientY - rect.top - 30) / 48))) : 0;
  }

  function maximumLane() {
    const height = canvasRef.current?.getBoundingClientRect().height ?? 0;
    return Math.max(1, Math.floor((height - 48) / 48));
  }

  function snap(value: number, movingId?: string) {
    return snapping ? snapTimelineTime(clips, value, time, movingId) : value;
  }

  function dropAsset(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDropError(undefined);
    const asset = files.find((file) => file.id === event.dataTransfer.getData("application/x-amplifier-asset"));
    if (!asset || asset.pending) return;
    const duration = asset.duration && asset.duration > 0 ? asset.duration : 5;
    const start = snap(timeAt(event.clientX));
    const lane = laneAt(event.clientY);
    if (asset.type.startsWith("video/")) {
      const linkId = crypto.randomUUID();
      const visualLane = Math.min(lane, Math.max(0, maximumLane() - 1));
      const audioLane = visualLane + 1;
      const collisionStart = collisionFreeStart(clips, start, [{ lane: visualLane, offset: 0, duration }, { lane: audioLane, offset: 0, duration }]);
      commit([...clips,
        { id: crypto.randomUUID(), asset, start: collisionStart, duration, lane: visualLane, sourceDuration: duration, trimStart: 0, role: "visual", linkId },
        { id: crypto.randomUUID(), asset, start: collisionStart, duration, lane: audioLane, sourceDuration: duration, trimStart: 0, role: "audio", linkId },
      ]);
      return;
    }
    const role = asset.type.startsWith("audio/") ? "audio" : "visual";
    const targetLane = role === "audio" ? Math.max(1, lane) : lane;
    const collisionStart = collisionFreeStart(clips, start, [{ lane: targetLane, offset: 0, duration }]);
    commit([...clips, { id: crypto.randomUUID(), asset, start: collisionStart, duration, lane: targetLane, sourceDuration: duration, trimStart: 0, role }]);
  }

  function moveClip(id: string, clientX: number, clientY: number) {
    const desiredStart = Math.max(0, Math.min(timelineDuration - .25, snap(timeAt(clientX) - dragOffset.current, id)));
    const next = moveTimelineClip(clips, id, desiredStart, laneAt(clientY), maximumLane());
    if (!sameClips(next, clips)) editChanged.current = true;
    onClipsChange(next);
  }

  function trimClip(id: string, edge: "start" | "end", clientX: number) {
    const next = trimTimelineClip(clips, id, edge, snap(timeAt(clientX), id));
    if (!sameClips(next, clips)) editChanged.current = true;
    onClipsChange(next);
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

  function beginEdit() {
    editSnapshot.current = clips;
    editChanged.current = false;
  }

  function finishEdit() {
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

  useTimelineShortcuts({ onDelete: deleteSelected, onDeselect: () => setSelectedId(undefined), onFit: fitTimeline, onRedo: redo, onSeek: (change) => onTimeChange(Math.max(0, Math.min(contentDuration, time + change))), onSetPlaying: onPlayingChange, onSplit: splitSelected, onTogglePlayback: () => onPlayingChange(!playing), onToggleSnapping: () => setSnapping((value) => !value), onUndo: undo, onZoom: (change) => setScale((value) => Math.max(1, Math.min(8, value + change))) });

  const clipHandlers: TimelineClipHandlers = { onBeginEdit: beginEdit, onEndEdit: finishEdit, onMove: moveClip, onSelect: setSelectedId, onTrim: trimClip };

  return (
    <section className={styles.timeline} aria-label="Timeline">
      <header>
        <section className={styles.toolGroup}>
          <strong>Timeline</strong>
          <nav aria-label="Timeline edit tools">
            <button aria-label="Select" type="button"><MousePointer2 size={15} /></button>
            <button aria-keyshortcuts="Meta+Z Control+Z" aria-label="Undo" disabled={!undoCount} onClick={undo} type="button"><Undo2 size={15} /></button>
            <button aria-keyshortcuts="Meta+Shift+Z Control+Shift+Z" aria-label="Redo" disabled={!redoCount} onClick={redo} type="button"><Redo2 size={15} /></button>
            <button aria-keyshortcuts="S" aria-label="Split at playhead" disabled={!selectedId} onClick={splitSelected} type="button"><Scissors size={15} /></button>
            <button aria-keyshortcuts="Delete Backspace" aria-label="Delete selected clip" disabled={!selectedId} onClick={() => deleteSelected()} type="button"><Trash2 size={15} /></button>
            <button aria-keyshortcuts="Shift+Delete Shift+Backspace" aria-label="Ripple delete selected clip" disabled={!selectedId} onClick={() => deleteSelected(true)} type="button"><ChevronsLeft size={15} /></button>
            <button aria-keyshortcuts="N" aria-label={`${snapping ? "Disable" : "Enable"} snapping`} aria-pressed={snapping} onClick={() => setSnapping((value) => !value)} type="button"><Magnet size={15} /></button>
          </nav>
        </section>
        <section className={styles.playback}><button aria-keyshortcuts="Space" aria-label={playing ? "Pause" : "Play"} onClick={() => onPlayingChange(!playing)} type="button">{playing ? <Pause size={16} /> : <Play size={16} />}</button><time>{formatTime(time)}</time></section>
        <section className={styles.toolGroup} data-end><nav aria-label="Timeline view"><button aria-keyshortcuts="-" aria-label="Zoom out" disabled={scale <= 1} onClick={() => setScale((value) => Math.max(1, value - 1))} type="button"><ZoomOut size={15} /></button><button aria-keyshortcuts="0" aria-label="Fit timeline" onClick={fitTimeline} type="button"><Maximize2 size={15} /></button><button aria-keyshortcuts="+" aria-label="Zoom in" disabled={scale >= 8} onClick={() => setScale((value) => Math.min(8, value + 1))} type="button"><ZoomIn size={15} /></button></nav></section>
      </header>
      <section className={styles.composition}>
        {(dropError || error) && <p className={styles.dropError} role="alert">{dropError || error}</p>}
        <section className={styles.viewport} ref={viewportRef}>
          <section className={styles.timelineCanvas} style={{ "--timeline-scale": scale } as CSSProperties}>
            <ol className={styles.ruler} aria-hidden="true">{stops(timelineDuration, scale).map((stop) => <li key={stop} style={{ left: `${(stop / timelineDuration) * 100}%` }}>{formatTime(stop)}</li>)}</ol>
            <section aria-label="Editable timeline" className={styles.canvas} onDragOver={(event) => event.preventDefault()} onDrop={dropAsset} onPointerDown={startScrub} onPointerMove={scrub} ref={canvasRef}>
              {clips.map((clip) => <TimelineClipItem clip={clip} dragOffsetRef={dragOffset} handlers={clipHandlers} key={clip.id} selected={clip.id === selectedId} timelineDuration={timelineDuration} />)}
              {!clips.length && <p className={styles.empty}>Drag media here</p>}
              <i aria-hidden="true" className={styles.playhead} style={{ left: `${(time / timelineDuration) * 100}%` }} />
            </section>
          </section>
        </section>
      </section>
      <TimelineModeSwitcher />
    </section>
  );
}

function stops(duration: number, scale: number) {
  const step = scale >= 5 ? 2 : scale >= 2 ? 5 : 10;
  return Array.from({ length: Math.floor(duration / step) + 1 }, (_, index) => index * step);
}

function formatTime(value: number) {
  return `${Math.floor(value / 60)}:${Math.floor(value % 60).toString().padStart(2, "0")}`;
}

function sameClips(left: TimelineClip[], right: TimelineClip[]) {
  return left === right || left.length === right.length && left.every((clip, index) => clip === right[index] || clip.id === right[index]?.id && clip.start === right[index]?.start && clip.duration === right[index]?.duration && clip.lane === right[index]?.lane && clip.trimStart === right[index]?.trimStart && clip.linkId === right[index]?.linkId);
}
