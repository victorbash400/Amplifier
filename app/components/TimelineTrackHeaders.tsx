import Image from "next/image";
import type { TimelineClip } from "./timelineTypes";
import { trackTop, type TimelineTrack } from "./timelineTracks";
import styles from "./TimelinePanel.module.css";

export function TimelineTrackHeaders({ clips, tracks }: { clips: TimelineClip[]; tracks: TimelineTrack[] }) {
  return <section aria-label="Timeline tracks" className={styles.trackHeaders}>{tracks.map((track) => {
    const count = clips.filter((clip) => clip.lane === track.lane && clip.role === track.role).length;
    const icon = track.role === "visual" ? "/accessible-media-icons/video-file-2-svgrepo-com.svg" : "/accessible-media-icons/music-note-svgrepo-com.svg";
    return <section className={styles.trackHeader} data-role={track.role} data-temporary={track.temporary || undefined} key={`${track.role}-${track.lane}`} style={{ top: trackTop(track.role, track.lane) }}><Image alt="" height={18} src={icon} width={18} /><span><b>{track.temporary ? `+ ${track.label}` : track.label}</b><small>{track.temporary ? "Drop to create" : `${count} ${count === 1 ? "Clip" : "Clips"}`}</small></span></section>;
  })}</section>;
}
