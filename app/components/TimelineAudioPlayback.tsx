"use client";

import { useEffect, useRef } from "react";
import { assetUrl } from "../lib/assetUploads";
import type { TimelineAudioPreview } from "./timelineTypes";

export function TimelineAudioPlayback({ clips, playing, volume }: { clips: TimelineAudioPreview[]; playing: boolean; volume: number }) {
  return <>{clips.map((clip) => <TimelineAudioTrack clip={clip} key={clip.id} playing={playing} volume={volume} />)}</>;
}

function TimelineAudioTrack({ clip, playing, volume }: { clip: TimelineAudioPreview; playing: boolean; volume: number }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const audio = ref.current;
    if (!audio) return;
    if (Math.abs(audio.currentTime - clip.sourceTime) > .2) audio.currentTime = clip.sourceTime;
    audio.volume = Math.max(0, Math.min(1, volume * clip.volume));
    if (playing) void audio.play().catch(() => undefined);
    else audio.pause();
  }, [clip.sourceTime, clip.volume, playing, volume]);
  return <audio preload="metadata" ref={ref} src={assetUrl(clip.asset)} />;
}
