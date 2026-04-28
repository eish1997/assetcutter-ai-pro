export const LAYOUT_VERSION = 1 as const;

export type ManifestEntryV1 = {
  key: string;
  relPath: string;
  byteSize: number;
  tags: string[];
  lineage: null | { parentKey?: string };
  mime?: string;
  updatedAt: number;
};

export type ProjectManifestV1 = {
  layoutVersion: typeof LAYOUT_VERSION;
  projectId: string;
  updatedAt: number;
  entries: ManifestEntryV1[];
};

export function emptyManifest(projectId: string): ProjectManifestV1 {
  return { layoutVersion: LAYOUT_VERSION, projectId, updatedAt: Date.now(), entries: [] };
}
