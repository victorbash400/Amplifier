"use client";

import { useEffect, useRef } from "react";
import { assetUrl } from "../lib/assetUploads";
import type { TimelineAudioPreview } from "./timelineTypes";

export function TimelineAudioPlayback({ clips, playing, timelineTime, volume }: { clips: TimelineAudioPreview[]; playing: boolean; timelineTime: number; volume: number }) {
  return <>{clips.map((clip) => <TimelineAudioTrack clip={clip} key={clip.id} playing={playing} timelineTime={timelineTime} volume={volume} />)}</>;
}

function TimelineAudioTrack({ clip, playing, timelineTime, volume }: { clip: TimelineAudioPreview; playing: boolean; timelineTime: number; volume: number }) {
  const ref = useRef<HTMLAudioElement>(null);
  const timelineTimeRef = useRef(timelineTime);
  const sample = useRef({ at: 0, time: timelineTime });
  const active = timelineTime >= clip.start && timelineTime < clip.start + clip.duration;
  const sourceTime = clip.trimStart + timelineTime - clip.start;

  useEffect(() => { timelineTimeRef.current = timelineTime; }, [timelineTime]);

  useEffect(() => {
    const audio = ref.current;
    if (!audio) return;
    if (!active) {
      audio.pause();
      return;
    }
    const currentSourceTime = clip.trimStart + timelineTimeRef.current - clip.start;
    audio.currentTime = currentSourceTime;
    sample.current = { at: performance.now(), time: timelineTimeRef.current };
    if (playing) void audio.play().catch(() => undefined);
    else audio.pause();
  }, [active, clip.start, clip.trimStart, playing]);

  useEffect(() => {
    const audio = ref.current;
    if (!audio || !active) return;
    const now = performance.now();
    const previous = sample.current;
    const timelineAdvance = timelineTime - previous.time;
    const clockAdvance = playing ? (now - previous.at) / 1000 : 0;
    sample.current = { at: now, time: timelineTime };
    if (!playing || Math.abs(timelineAdvance - clockAdvance) > .12) audio.currentTime = sourceTime;
  }, [active, playing, sourceTime, timelineTime]);

  useEffect(() => {
    const audio = ref.current;
    if (!audio) return;
    audio.volume = Math.max(0, Math.min(1, volume * clip.volume));
  }, [clip.volume, volume]);

  return <audio preload="auto" ref={ref} src={assetUrl(clip.asset)} />;
}
