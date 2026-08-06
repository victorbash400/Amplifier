"use client";

import { useEffect, useMemo, useState } from "react";
import { assetUrl } from "../lib/assetUploads";
import type { ProjectFile } from "../types/workspace";
import styles from "./TimelinePanel.module.css";

const waveformCache = new Map<string, Promise<number[]>>();

export function TimelineAudioWaveform({ asset, duration, trimStart }: { asset: ProjectFile; duration: number; trimStart: number }) {
  const [samples, setSamples] = useState<number[]>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    loadWaveform(asset).then((next) => { if (active) setSamples(next); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [asset]);
  const path = useMemo(() => waveformPath(samples, asset.duration, trimStart, duration), [asset.duration, duration, samples, trimStart]);
  if (failed) return <span className={styles.waveformError}>Waveform unavailable</span>;
  return <svg aria-label={`${asset.name} audio waveform`} className={styles.waveform} preserveAspectRatio="none" role="img" viewBox="0 0 100 32"><path d={path} /></svg>;
}

function loadWaveform(asset: ProjectFile) {
  const key = `${asset.id}:${asset.generation || "local"}`;
  const cached = waveformCache.get(key);
  if (cached) return cached;
  const request = fetch(assetUrl(asset)).then(async (response) => {
    if (!response.ok) throw new Error("Could not load audio waveform");
    const context = new AudioContext();
    try { return sampleChannel((await context.decodeAudioData(await response.arrayBuffer())).getChannelData(0), 240); }
    finally { void context.close(); }
  });
  waveformCache.set(key, request);
  request.catch(() => waveformCache.delete(key));
  return request;
}

function sampleChannel(channel: Float32Array, count: number) {
  const block = Math.max(1, Math.floor(channel.length / count));
  const peaks = Array.from({ length: count }, (_, index) => {
    let peak = 0;
    for (let position = index * block; position < Math.min(channel.length, (index + 1) * block); position += 1) peak = Math.max(peak, Math.abs(channel[position]));
    return peak;
  });
  const maximum = Math.max(.01, ...peaks);
  return peaks.map((peak) => peak / maximum);
}

function waveformPath(samples: number[] | undefined, sourceDuration = 0, trimStart = 0, duration = 0) {
  if (!samples?.length) return "M0 16H100";
  const start = sourceDuration ? Math.floor((trimStart / sourceDuration) * samples.length) : 0;
  const end = sourceDuration ? Math.ceil(((trimStart + duration) / sourceDuration) * samples.length) : samples.length;
  const visible = samples.slice(start, Math.max(start + 1, end));
  const barCount = Math.min(64, visible.length);
  return Array.from({ length: barCount }, (_, index) => {
    const peak = visible[Math.min(visible.length - 1, Math.floor((index / barCount) * visible.length))];
    const x = ((index + .5) / barCount) * 100;
    const height = Math.max(1.5, peak * 13);
    return `M${x.toFixed(2)} ${(16 - height).toFixed(2)}V${(16 + height).toFixed(2)}`;
  }).join("");
}
