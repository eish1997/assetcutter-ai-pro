import { resolveStoryboardRoleAssetDisplaySrc } from './storyboardRoleAssets';
import { resolveStoryboardSceneAssetDisplaySrc } from './storyboardSceneAssets';

export const STORYBOARD_NAMED_ASSET_IMPORT_MAX_FILES = 50;

type NamedAssetLike = { id: string; image?: string; imageCompanionKey?: string };

export function storyboardNamedAssetHasImageRef(asset: NamedAssetLike): boolean {
  return Boolean(
    String(asset.image || '').trim() ||
      String(asset.imageCompanionKey || '').trim()
  );
}

export function resolveStoryboardNamedAssetImportStartIndex(
  assets: NamedAssetLike[],
  startAssetId: string | null | undefined,
  resolveHasImage: (asset: NamedAssetLike) => boolean = storyboardNamedAssetHasImageRef
): number {
  if (startAssetId) {
    const idx = assets.findIndex((a) => a.id === startAssetId);
    if (idx >= 0) return idx;
  }
  const firstEmpty = assets.findIndex((a) => !resolveHasImage(a));
  return firstEmpty >= 0 ? firstEmpty : 0;
}

export type StoryboardNamedAssetImportAssignment = {
  assetId: string;
  fileIndex: number;
};

/** 从起始资产起顺序分配；已有图的槽位跳过（除非起始点即该槽，则允许覆盖首文件） */
export function planStoryboardNamedAssetImportAssignments(
  assets: NamedAssetLike[],
  startAssetId: string | null | undefined,
  fileCount: number,
  options?: { overwriteStart?: boolean }
): {
  assignments: StoryboardNamedAssetImportAssignment[];
  skippedFilled: number;
  unusedFiles: number;
} {
  if (fileCount <= 0 || assets.length === 0) {
    return { assignments: [], skippedFilled: 0, unusedFiles: fileCount };
  }

  const overwriteStart = options?.overwriteStart ?? Boolean(startAssetId);
  const from = resolveStoryboardNamedAssetImportStartIndex(assets, startAssetId);
  const assignments: StoryboardNamedAssetImportAssignment[] = [];
  let skippedFilled = 0;
  let fileIndex = 0;

  for (let i = from; i < assets.length && fileIndex < fileCount; i += 1) {
    const asset = assets[i]!;
    const filled = storyboardNamedAssetHasImageRef(asset);
    const isStart = i === from;
    if (filled && !(isStart && overwriteStart && fileIndex === 0)) {
      skippedFilled += 1;
      continue;
    }
    assignments.push({ assetId: asset.id, fileIndex });
    fileIndex += 1;
  }

  return {
    assignments,
    skippedFilled,
    unusedFiles: Math.max(0, fileCount - assignments.length),
  };
}

export function resolveStoryboardNamedAssetDisplayHasImage(
  asset: NamedAssetLike,
  kind: 'role' | 'scene'
): boolean {
  const src =
    kind === 'role'
      ? resolveStoryboardRoleAssetDisplaySrc(asset)
      : resolveStoryboardSceneAssetDisplaySrc(asset);
  return Boolean(String(src || '').trim());
}
