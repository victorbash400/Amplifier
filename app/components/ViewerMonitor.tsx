"use client";

import { Maximize2, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ProjectFile } from "../types/workspace";
import type { TimelinePreviewState } from "./timelineTypes";
import { ViewerMediaFrame } from "./ViewerMediaFrame";
import { TimelineAudioPlayback } from "./TimelineAudioPlayback";
import { ViewerCaptionOverlay } from "./ViewerCaptionOverlay";
import { ViewerVolumeControl } from "./ViewerVolumeControl";
import styles from "./ViewerMonitor.module.css";

export function ViewerMonitor({ asset, sourceStart = 0, timeline, title }: { asset?: ProjectFile; sourceStart?: number; timeline?: TimelinePreviewState; title: "Preview" | "Timeline" }) {
  const mediaRef = useRef<HTMLMediaElement>(null);
  const timelineRef = useRef(timeline);
  const frameRef = useRef<HTMLElement>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewTime, setPreviewTime] = useState(sourceStart);
  const [previewDuration, setPreviewDuration] = useState(asset?.duration ?? 0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);

  const playing = timeline?.playing || previewPlaying;
  const timelineSourceTime = timeline?.sourceTime;

  useEffect(() => { timelineRef.current = timeline; }, [timeline]);

  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;
    if (playing) {
      if (timelineRef.current) media.currentTime = timelineRef.current.sourceTime;
      void media.play().catch(() => undefined);
    } else media.pause();
  }, [playing]);

  useEffect(() => {
    const media = mediaRef.current;
    if (!media || timelineSourceTime === undefined || playing) return;
    media.currentTime = timelineSourceTime;
  }, [playing, timelineSourceTime]);

  useEffect(() => {
    if (mediaRef.current) mediaRef.current.muted = Boolean(timeline?.audio.length) || muted;
  }, [muted, timeline?.audio.length]);

  useEffect(() => {
    const media = mediaRef.current;
    if (!media || timeline) return;
    const updateTime = () => setPreviewTime(media.currentTime);
    const updateDuration = () => {
      const duration = Number.isFinite(media.duration) ? media.duration : 0;
      setPreviewDuration(duration);
      media.currentTime = Math.min(sourceStart, duration || sourceStart);
      setPreviewTime(media.currentTime);
    };
    media.addEventListener("timeupdate", updateTime);
    media.addEventListener("loadedmetadata", updateDuration);
    return () => { media.removeEventListener("timeupdate", updateTime); media.removeEventListener("loadedmetadata", updateDuration); };
  }, [asset, sourceStart, timeline]);

  const currentTime = timeline?.timelineTime ?? previewTime;
  const duration = timeline?.timelineDuration ?? previewDuration;
  const togglePlayback = () => timeline ? timeline.onTogglePlayback() : setPreviewPlaying((current) => !current);
  const setTime = (time: number) => {
    if (timeline) timeline.onSeek(time);
    else if (mediaRef.current) mediaRef.current.currentTime = time;
    setPreviewTime(time);
  };
  const seek = (change: number) => setTime(Math.max(0, Math.min(duration, currentTime + change)));
  function setMediaElement(media: HTMLMediaElement | null) { mediaRef.current = media; if (media) { media.volume = volume; media.muted = Boolean(timeline?.audio.length) || muted; } }
  function changeVolume(next: number) { setVolume(next); setMuted(false); if (mediaRef.current) { mediaRef.current.volume = next; mediaRef.current.muted = Boolean(timeline?.audio.length); } }
  function changeMuted(next: boolean) { setMuted(next); if (mediaRef.current) mediaRef.current.muted = Boolean(timeline?.audio.length) || next; }
  async function fullScreen() { await frameRef.current?.requestFullscreen(); }

  return <section className={styles.viewer} aria-label={`${title} viewer`}><header><span>{title}</span></header><section className={styles.mediaFrame} ref={frameRef}><ViewerMediaFrame asset={asset} onMediaElement={setMediaElement} visionAdjustments={timeline?.visionAdjustments}>{timeline?.captions && <ViewerCaptionOverlay cues={timeline.captions.cues} currentTime={currentTime} downloadText={timeline.captions.downloadText} kind={timeline.captions.kind} large={timeline.captions.large} onSeek={setTime} />}</ViewerMediaFrame></section>{timeline && <TimelineAudioPlayback clips={timeline.audio} playing={playing} volume={muted ? 0 : volume} />}<section className={styles.progress}><time>{formatTime(currentTime)}</time><input aria-label={`${title} position`} disabled={!duration} max={Math.max(duration, 0.01)} min="0" onChange={(event) => setTime(Number(event.target.value))} step="0.01" type="range" value={Math.min(currentTime, duration || 0)} /><time>{formatTime(duration)}</time></section><footer><nav aria-label={`${title} playback controls`}><button aria-label="Previous" onClick={() => seek(-1)} type="button"><SkipBack size={13} /></button><button aria-label={playing ? "Pause" : "Play"} onClick={togglePlayback} type="button">{playing ? <Pause size={14} /> : <Play size={14} fill="currentColor" />}</button><button aria-label="Next" onClick={() => seek(1)} type="button"><SkipForward size={13} /></button></nav><nav aria-label={`${title} viewer controls`}><ViewerVolumeControl muted={muted} onMutedChange={changeMuted} onVolumeChange={changeVolume} volume={volume} /><button aria-label="Full screen" onClick={() => void fullScreen()} type="button"><Maximize2 size={13} /></button></nav></footer></section>;
}

function formatTime(time: number) {
  const seconds = Math.max(0, Math.floor(time)).toString().padStart(2, "0");
  const frames = Math.floor((time % 1) * 30).toString().padStart(2, "0");
  return `00:00:${seconds}:${frames}`;
}
