export type MediaIndexStatus = "missing" | "queued" | "indexing" | "ready" | "failed";

export type MediaAssetState = {
  assetId: string;
  name?: string;
  status: MediaIndexStatus;
  stage?: string;
  progress?: number;
  error?: string;
  updatedAt?: string;
};

export type MediaSearchResult = {
  momentId: string;
  assetId: string;
  assetName: string;
  objectKey: string;
  contentType: string;
  folderId: string;
  thumbnailKey: string;
  description: string;
  transcript: string;
  start: number;
  end: number;
  score: number;
};
