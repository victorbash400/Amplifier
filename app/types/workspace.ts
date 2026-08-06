import type { FolderColor } from "../components/icons/FolderIcon";

export type AmplifierProject = {
  id: string;
  name: string;
  color: FolderColor;
};

export type ProjectFolder = {
  id: string;
  projectId: string;
  name: string;
  color: FolderColor;
  parentId?: string;
};

export type ProjectFile = {
  id: string;
  projectId: string;
  folderId: string;
  name: string;
  size: number;
  type: string;
  objectKey?: string;
  generation?: string;
  pending?: boolean;
  localUrl?: string;
  duration?: number;
  width?: number;
  height?: number;
};

export type WorkspaceData = {
  projects: AmplifierProject[];
  folders: ProjectFolder[];
  files: ProjectFile[];
};
