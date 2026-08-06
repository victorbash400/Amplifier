import type { ProjectFile } from "../types/workspace";

const chunkSize = 8 * 1024 * 1024;
const maxAttempts = 3;

type UploadSession = { upload_url: string; object_key: string };
type CompletedUpload = { object_key: string; generation: string; size: number; content_type: string };

export async function uploadProjectAsset({ assetId, file, folderId, localUrl, onProgress, projectId }: { assetId: string; file: File; folderId: string; localUrl: string; onProgress: (progress: number) => void; projectId: string }): Promise<ProjectFile> {
  const metadata = await readAssetMetadata(localUrl, file.type);
  const session = await request<UploadSession>("POST", { projectId, assetId, fileName: file.name, contentType: file.type || "application/octet-stream", size: file.size });
  await uploadChunks(session.upload_url, file, onProgress);
  const completed = await request<CompletedUpload>("PATCH", { projectId, assetId, fileName: file.name, size: file.size });
  return { id: assetId, projectId, folderId, name: file.name, size: completed.size, type: completed.content_type, objectKey: completed.object_key, generation: completed.generation, localUrl, ...metadata };
}

export function assetUrl(file: ProjectFile) {
  if (file.localUrl) return file.localUrl;
  if (!file.objectKey) return "";
  return `/api/assets/media?projectId=${encodeURIComponent(file.projectId)}&objectKey=${encodeURIComponent(file.objectKey)}`;
}

async function uploadChunks(uploadUrl: string, file: File, onProgress: (progress: number) => void) {
  let offset = 0;
  let attempts = 0;
  while (offset < file.size) {
    const end = Math.min(offset + chunkSize, file.size);
    try {
      const response = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Range": `bytes ${offset}-${end - 1}/${file.size}`,
          "Content-Type": file.type || "application/octet-stream",
        },
        body: file.slice(offset, end),
      });
      if (response.status !== 200 && response.status !== 201 && response.status !== 308) throw new Error(`Cloud Storage returned ${response.status}`);
      offset = persistedOffset(response.headers.get("Range"), response.status, end);
      attempts = 0;
      onProgress(Math.round((offset / file.size) * 100));
    } catch (reason) {
      attempts += 1;
      if (attempts >= maxAttempts) throw reason;
      offset = await uploadedOffset(uploadUrl, file.size);
      onProgress(Math.round((offset / file.size) * 100));
    }
  }
}

async function uploadedOffset(uploadUrl: string, size: number) {
  const response = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Range": `bytes */${size}` } });
  if (response.status === 200 || response.status === 201) return size;
  if (response.status !== 308) throw new Error(`Could not resume upload: Cloud Storage returned ${response.status}`);
  return persistedOffset(response.headers.get("Range"), response.status, 0);
}

function persistedOffset(range: string | null, status: number, completedEnd: number) {
  if (status === 200 || status === 201) return completedEnd;
  const match = range?.match(/bytes=0-(\d+)/);
  return match ? Number(match[1]) + 1 : 0;
}

async function request<T>(method: "POST" | "PATCH", body: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/assets/uploads", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({ error: "Asset upload request failed" })) as T & { error?: string };
  if (!response.ok) throw new Error(result.error || "Asset upload request failed");
  return result;
}

function readAssetMetadata(url: string, contentType: string) {
  if (contentType.startsWith("image/")) return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("Could not read image metadata"));
    image.src = url;
  });
  if (contentType.startsWith("video/") || contentType.startsWith("audio/")) return new Promise<{ duration: number; width?: number; height?: number }>((resolve, reject) => {
    const media = document.createElement(contentType.startsWith("video/") ? "video" : "audio");
    media.preload = "metadata";
    media.onloadedmetadata = () => {
      if (!Number.isFinite(media.duration)) return reject(new Error("Media duration is invalid"));
      resolve({ duration: media.duration, ...(media instanceof HTMLVideoElement ? { width: media.videoWidth, height: media.videoHeight } : {}) });
    };
    media.onerror = () => reject(new Error("Could not read media metadata"));
    media.src = url;
  });
  return Promise.resolve({});
}
