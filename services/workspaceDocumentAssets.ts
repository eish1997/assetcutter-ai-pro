import type { WorkspaceAssetPatch } from './workspaceDocumentProtocol';
import { sanitizeWorkspaceAssetPatch } from './workspaceDocumentProtocol';

export type DocumentAssetLike = {
  id?: string;
  assetKind?: string;
  displayKey?: string;
  textBody?: string;
  textTitle?: string;
  textResults?: Record<string, string>;
  originalCompanionKey?: string;
  originalObjectKey?: string;
  resultsCompanionKeys?: Record<string, string>;
  resultOrder?: string[];
};

export function toDocumentAssetPatch(asset: DocumentAssetLike | null | undefined): WorkspaceAssetPatch | null {
  if (!asset || typeof asset !== 'object') return null;
  return sanitizeWorkspaceAssetPatch({
    id: asset.id,
    assetKind: asset.assetKind,
    displayKey: asset.displayKey,
    textBody: asset.textBody,
    textTitle: asset.textTitle,
    textResults: asset.textResults,
    originalCompanionKey: asset.originalCompanionKey,
    originalObjectKey: asset.originalObjectKey,
    resultsCompanionKeys: asset.resultsCompanionKeys,
    resultOrder: asset.resultOrder,
  });
}

export function patchesFromAssets(assets: DocumentAssetLike[] | null | undefined): WorkspaceAssetPatch[] {
  const out: WorkspaceAssetPatch[] = [];
  for (const asset of Array.isArray(assets) ? assets : []) {
    const patch = toDocumentAssetPatch(asset);
    if (patch) out.push(patch);
  }
  return out;
}

export function documentAssetsKey(patches: WorkspaceAssetPatch[] | null | undefined): string {
  return JSON.stringify(Array.isArray(patches) ? patches : []);
}

export function diffDocumentAssets(
  prev: WorkspaceAssetPatch[] | null | undefined,
  next: WorkspaceAssetPatch[] | null | undefined,
): { upserts: WorkspaceAssetPatch[]; removedIds: string[] } {
  const prevList = Array.isArray(prev) ? prev : [];
  const nextList = Array.isArray(next) ? next : [];
  const prevById = new Map(prevList.map((p) => [p.id, p]));
  const nextIds = new Set(nextList.map((p) => p.id));
  const upserts: WorkspaceAssetPatch[] = [];
  for (const patch of nextList) {
    const before = prevById.get(patch.id);
    if (!before || JSON.stringify(before) !== JSON.stringify(patch)) upserts.push(patch);
  }
  const removedIds = prevList.map((p) => p.id).filter((id) => !nextIds.has(id));
  return { upserts, removedIds };
}
