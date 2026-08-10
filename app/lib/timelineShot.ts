import type { TimelineDocument } from "./timelineDocument";
import type { ProjectFile } from "../types/workspace";

export type TimelineShot = {
  id: string;
  projectId: string;
  revision: number;
  capturedAt: string;
  image: string;
  imageWidth: number;
  imageHeight: number;
  view: { playhead: number; selectedClipIds: string[]; visibleStart: number; visibleEnd: number };
  tracks: { id: string; role: "visual" | "audio"; lane: number }[];
  clips: { id: string; assetId: string; name: string; role: "visual" | "audio"; lane: number; start: number; end: number; trimStart: number; duration: number; linkId?: string }[];
  diagnostics: { overlaps: string[][]; gaps: { start: number; end: number }[]; brokenLinks: string[]; outOfBoundsClipIds: string[] };
};

export async function captureTimelineShot(projectId: string, timeline: TimelineDocument, files: ProjectFile[], playhead: number, selectedClipIds: string[]) {
  const names = new Map(files.map((file) => [file.id, file.name]));
  const clips = timeline.clips.map((clip) => ({ id: clip.id, assetId: clip.assetId, name: names.get(clip.assetId) || "Unavailable media", role: clip.role, lane: clip.lane, start: clip.start, end: clip.start + clip.duration, trimStart: clip.trimStart, duration: clip.duration, ...(clip.linkId ? { linkId: clip.linkId } : {}) }));
  const visibleEnd = Math.max(20, ...clips.map((clip) => clip.end));
  const tracks = (["visual", "audio"] as const).flatMap((role) => Array.from({ length: timeline.trackCounts[role] }, (_, lane) => ({ id: `${role}-${lane}`, role, lane })));
  const shot: TimelineShot = {
    id: crypto.randomUUID(), projectId, revision: timeline.revision, capturedAt: new Date().toISOString(), image: "", imageWidth: 928, imageHeight: 286,
    view: { playhead, selectedClipIds, visibleStart: 0, visibleEnd }, tracks, clips,
    diagnostics: diagnostics(clips),
  };
  const rendered = renderTimelineShot(shot);
  shot.image = rendered.image;
  shot.imageWidth = rendered.width;
  shot.imageHeight = rendered.height;
  return shot;
}

export function timelineShotFromToolResult(projectId: string, result: Record<string, unknown>, files: ProjectFile[]) {
  const raw = result.shot;
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  if (value.projectId !== projectId || !Array.isArray(value.clips)) return undefined;
  const names = new Map(files.map((file) => [file.id, file.name]));
  const clips: TimelineShot["clips"] = value.clips.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const clip = item as Record<string, unknown>;
    if (typeof clip.id !== "string" || typeof clip.assetId !== "string" || (clip.role !== "visual" && clip.role !== "audio") || typeof clip.lane !== "number" || typeof clip.start !== "number" || typeof clip.duration !== "number" || typeof clip.trimStart !== "number") return [];
    const role: "visual" | "audio" = clip.role;
    return [{ id: clip.id, assetId: clip.assetId, name: typeof clip.assetName === "string" ? clip.assetName : names.get(clip.assetId) || "Unavailable media", role, lane: clip.lane, start: clip.start, end: clip.start + clip.duration, trimStart: clip.trimStart, duration: clip.duration, ...(typeof clip.linkId === "string" ? { linkId: clip.linkId } : {}) }];
  });
  const counts = value.trackCounts && typeof value.trackCounts === "object" ? value.trackCounts as Record<string, unknown> : {};
  const tracks: TimelineShot["tracks"] = Array.isArray(value.tracks) ? value.tracks.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const track = item as Record<string, unknown>;
    if ((track.role !== "visual" && track.role !== "audio") || typeof track.lane !== "number") return [];
    const role: "visual" | "audio" = track.role;
    return [{ id: typeof track.id === "string" ? track.id : `${role}-${track.lane}`, role, lane: track.lane }];
  }) : (["visual", "audio"] as const).flatMap((role) => Array.from({ length: Math.max(1, Number(counts[role]) || 1) }, (_, lane) => ({ id: `${role}-${lane}`, role, lane })));
  const nestedView = value.view && typeof value.view === "object" ? value.view as Record<string, unknown> : {};
  const selectedClipIds = Array.isArray(value.selectedClipIds) ? value.selectedClipIds.filter((id): id is string => typeof id === "string") : Array.isArray(nestedView.selectedClipIds) ? nestedView.selectedClipIds.filter((id): id is string => typeof id === "string") : [];
  const visibleEnd = Math.max(20, ...clips.map((clip) => clip.end));
  const shot: TimelineShot = {
    id: typeof value.id === "string" ? value.id : crypto.randomUUID(),
    projectId,
    revision: Number(value.revision) || 0,
    capturedAt: typeof value.capturedAt === "string" ? value.capturedAt : new Date().toISOString(),
    image: "",
    imageWidth: 928,
    imageHeight: 286,
    view: { playhead: Number(value.playhead ?? nestedView.playhead) || 0, selectedClipIds, visibleStart: 0, visibleEnd },
    tracks,
    clips,
    diagnostics: diagnostics(clips),
  };
  const rendered = renderTimelineShot(shot);
  shot.image = rendered.image;
  shot.imageWidth = rendered.width;
  shot.imageHeight = rendered.height;
  return shot;
}

function diagnostics(clips: TimelineShot["clips"]): TimelineShot["diagnostics"] {
  const overlaps: string[][] = [];
  for (let index = 0; index < clips.length; index += 1) for (let other = index + 1; other < clips.length; other += 1) {
    const left = clips[index];
    const right = clips[other];
    if (left.role === right.role && left.lane === right.lane && left.start < right.end && right.start < left.end) overlaps.push([left.id, right.id]);
  }
  const visual = clips.filter((clip) => clip.role === "visual").sort((left, right) => left.start - right.start);
  const gaps = visual.slice(1).flatMap((clip, index) => clip.start > visual[index].end ? [{ start: visual[index].end, end: clip.start }] : []);
  const links = new Map<string, number>();
  clips.forEach((clip) => { if (clip.linkId) links.set(clip.linkId, (links.get(clip.linkId) || 0) + 1); });
  return { overlaps, gaps, brokenLinks: clips.filter((clip) => clip.linkId && links.get(clip.linkId) === 1).map((clip) => clip.id), outOfBoundsClipIds: clips.filter((clip) => clip.start < 0 || clip.duration <= 0 || clip.trimStart < 0).map((clip) => clip.id) };
}

function renderTimelineShot(shot: TimelineShot) {
  const canvas = document.createElement("canvas");
  canvas.width = 928;
  const rowHeight = 78;
  canvas.height = Math.min(560, Math.max(286, 118 + rowHeight * Math.max(1, shot.tracks.length)));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Timeline capture is unavailable in this browser");
  context.fillStyle = "#f8f8f6";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#252522";
  context.font = "650 22px system-ui";
  context.fillText("Timeline", 24, 36);
  context.font = "14px system-ui";
  context.fillStyle = "#777772";
  context.fillText(`Revision ${shot.revision} · ${shot.clips.length} clips · ${shot.tracks.length} tracks`, 24, 60);
  const left = 112;
  const top = 96;
  const width = 792;
  context.strokeStyle = "#dfdfdc";
  context.lineWidth = 1;
  for (let tick = 0; tick <= 5; tick += 1) {
    const x = left + width * tick / 5;
    context.beginPath(); context.moveTo(x, 76); context.lineTo(x, top + rowHeight * shot.tracks.length); context.stroke();
    context.fillStyle = "#888883"; context.font = "12px ui-monospace"; context.fillText(`${Math.round(shot.view.visibleEnd * tick / 5)}s`, x + 4, 90);
  }
  shot.tracks.forEach((track, index) => {
    const y = top + index * rowHeight;
    context.fillStyle = "#676763"; context.font = "600 13px system-ui"; context.fillText(`${track.role === "visual" ? "Video" : "Audio"} ${track.lane + 1}`, 24, y + rowHeight / 2 + 4);
    context.fillStyle = index % 2 ? "#ededeb" : "#f1f1ef"; roundedRect(context, left, y + 3, width, rowHeight - 8, 7);
    shot.clips.filter((clip) => clip.role === track.role && clip.lane === track.lane).forEach((clip) => {
      const x = left + clip.start / shot.view.visibleEnd * width;
      const clipWidth = Math.max(8, clip.duration / shot.view.visibleEnd * width);
      context.fillStyle = shot.view.selectedClipIds.includes(clip.id) ? "#47705d" : track.role === "visual" ? "#789582" : "#8390a2";
      roundedRect(context, x + 3, y + 9, clipWidth - 6, rowHeight - 20, 8);
      context.fillStyle = "#fff"; context.font = "600 13px system-ui"; context.save(); context.beginPath(); context.rect(x + 8, y + 7, Math.max(0, clipWidth - 16), rowHeight - 18); context.clip(); context.fillText(clip.name, x + 10, y + rowHeight / 2 + 5); context.restore();
    });
  });
  const playheadX = left + Math.min(shot.view.playhead, shot.view.visibleEnd) / shot.view.visibleEnd * width;
  context.strokeStyle = "#b14e42"; context.lineWidth = 2; context.beginPath(); context.moveTo(playheadX, 76); context.lineTo(playheadX, top + rowHeight * shot.tracks.length); context.stroke();
  return { image: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height };
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath(); context.roundRect(x, y, Math.max(1, width), Math.max(1, height), radius); context.fill();
}
