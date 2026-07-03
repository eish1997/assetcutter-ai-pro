import type { WorkflowAsset } from '../types';
import { assetSetPreviewImages, isWorkflowAssetSetAsset } from './assetSet/assetSetAsset';
import { getGroupCoverImage, isGroupAsset, isGroupChildAsset } from './groupHelpers';
import { isWorkflowStoryboardTableAsset, storyboardTableCoverImage } from './storyboardTableAsset';
import { resolveStoryboardFrameDisplaySrc } from './storyboardFrameImageUrl';
import { fetchWorkflowOriginalFromCompanionAsObjectUrl } from './workflowCompanionAssets';
import {
  isWorkflowTextAsset,
  workflowAssetCurrentDisplayIsTextChannel,
  workflowAssetLightboxRasterEligible,
} from './workflowTextAsset';
import {
  loadWorkflowBundle,
  type WorkflowProjectBundle,
  type WorkspacePersistUserId,
} from './workspaceProjectStore';
import { normalizeCompanionBaseUrl } from './companionLocalPrefs';

const asWorkflowImageString = (v: unknown): string => (typeof v === 'string' ? v : '');

export const WORKSPACE_PROJECT_PREVIEW_LIMIT = 8;

export type WorkspaceProjectPreviewItem = {
  assetId: string;
  src: string;
};

function resolveWorkflowAssetPreviewObjectKeySrc(asset: WorkflowAsset): string {
  const dk = String(asset.displayKey || 'original').trim() || 'original';
  if (dk === 'original') {
    return resolveStoryboardFrameDisplaySrc('', asset.originalObjectKey) || '';
  }
  const stepKey = String(asset.resultsObjectKeys?.[dk] || '').trim();
  if (stepKey) {
    return resolveStoryboardFrameDisplaySrc('', stepKey) || '';
  }
  return resolveStoryboardFrameDisplaySrc('', asset.originalObjectKey) || '';
}

function resolveWorkflowAssetPreviewInlineSrc(asset: WorkflowAsset, allAssets: WorkflowAsset[]): string {
  if (isWorkflowStoryboardTableAsset(asset)) {
    return storyboardTableCoverImage(asset).trim();
  }
  if (isWorkflowAssetSetAsset(asset)) {
    return assetSetPreviewImages(asset, 1)[0]?.trim() || '';
  }
  if (isGroupAsset(asset)) {
    return getGroupCoverImage(asset, allAssets, (member) =>
      resolveWorkflowAssetPreviewSrc(member, allAssets)
    ).trim();
  }
  const orig = asWorkflowImageString(asset.original).trim();
  if (isWorkflowTextAsset(asset)) {
    if (workflowAssetCurrentDisplayIsTextChannel(asset)) return '';
    if (asset.displayKey === 'original') return orig;
    const fromResults = (asset.results as Record<string, unknown>)[asset.displayKey];
    return asWorkflowImageString(fromResults).trim() || orig;
  }
  if (asset.displayKey === 'original') return orig;
  const fromResults = (asset.results as Record<string, unknown>)[asset.displayKey];
  return asWorkflowImageString(fromResults).trim() || orig;
}

export function resolveWorkflowAssetPreviewSrc(asset: WorkflowAsset, allAssets: WorkflowAsset[]): string {
  const inline = resolveWorkflowAssetPreviewInlineSrc(asset, allAssets).trim();
  if (inline) return inline;
  return resolveWorkflowAssetPreviewObjectKeySrc(asset);
}

/** 伴侣磁盘键：IDB 剥离内联图后，列表预览需异步从伴侣拉取 */
export function resolveWorkflowAssetPreviewCompanionKey(
  asset: WorkflowAsset,
  allAssets: WorkflowAsset[]
): string {
  if (isWorkflowStoryboardTableAsset(asset)) {
    for (const row of asset.storyboardTable?.rows ?? []) {
      const key = String(row.frameImageCompanionKey || '').trim();
      if (key) return key;
    }
    return '';
  }
  if (isWorkflowAssetSetAsset(asset)) {
    for (const component of asset.assetSet?.components ?? []) {
      const cropKey = String(component.cropPreviewCompanionKey || '').trim();
      if (cropKey) return cropKey;
      const sheetKey = String(component.multiviewSheetCompanionKey || '').trim();
      if (sheetKey) return sheetKey;
      for (const view of component.views ?? []) {
        const viewKey = String(view.imageCompanionKey || '').trim();
        if (viewKey) return viewKey;
      }
      const previewKey = String(component.model3d?.previewCompanionKey || '').trim();
      if (previewKey) return previewKey;
    }
    for (const source of asset.assetSet?.sourceAssets ?? []) {
      const sourceKey = String(source.imageCompanionKey || '').trim();
      if (sourceKey) return sourceKey;
    }
    return '';
  }
  if (isGroupAsset(asset)) {
    for (const memberId of asset.assetIds ?? []) {
      const member = allAssets.find((a) => a.id === memberId);
      if (!member) continue;
      const key = resolveWorkflowAssetPreviewCompanionKey(member, allAssets);
      if (key) return key;
    }
    return '';
  }
  if (isWorkflowTextAsset(asset)) {
    return '';
  }
  const dk = String(asset.displayKey || 'original').trim() || 'original';
  if (dk === 'original') {
    return String(asset.originalCompanionKey || '').trim();
  }
  return (
    String(asset.resultsCompanionKeys?.[dk] || '').trim() ||
    String(asset.originalCompanionKey || '').trim()
  );
}

function assetHasWorkspacePreviewRef(asset: WorkflowAsset, allAssets: WorkflowAsset[]): boolean {
  const src = resolveWorkflowAssetPreviewSrc(asset, allAssets);
  if (src && workflowAssetLightboxRasterEligible(asset, src)) return true;
  return Boolean(resolveWorkflowAssetPreviewCompanionKey(asset, allAssets));
}

function isRootPreviewCandidate(asset: WorkflowAsset): boolean {
  if (asset.archived) return false;
  if (isGroupChildAsset(asset)) return false;
  if (asset.parentAssetId) return false;
  return true;
}

export function pickWorkflowProjectPreviews(
  bundle: WorkflowProjectBundle,
  limit = WORKSPACE_PROJECT_PREVIEW_LIMIT
): { items: WorkspaceProjectPreviewItem[]; totalEligible: number; rootAssetCount: number } {
  const assets = bundle.assets ?? [];
  const items: WorkspaceProjectPreviewItem[] = [];
  let totalEligible = 0;
  let rootAssetCount = 0;

  for (const asset of assets) {
    if (!isRootPreviewCandidate(asset)) continue;
    if (asset.inRepository) continue;
    rootAssetCount += 1;
    if (!assetHasWorkspacePreviewRef(asset, assets)) continue;
    totalEligible += 1;
    const src = resolveWorkflowAssetPreviewSrc(asset, assets);
    if (!src || !workflowAssetLightboxRasterEligible(asset, src)) continue;
    if (items.length < limit) {
      items.push({ assetId: asset.id, src });
    }
  }

  return { items, totalEligible, rootAssetCount };
}

export function loadWorkspaceProjectPreviews(
  projectId: string,
  persistUserId: WorkspacePersistUserId = null,
  limit = WORKSPACE_PROJECT_PREVIEW_LIMIT
): { items: WorkspaceProjectPreviewItem[]; totalEligible: number; rootAssetCount: number } {
  const bundle = loadWorkflowBundle(projectId, persistUserId);
  return pickWorkflowProjectPreviews(bundle, limit);
}

/** 同步解析 + 伴侣拉取，填满最多 limit 张预览（未打开项目时补全伴侣键缩略图） */
export async function loadWorkspaceProjectPreviewsResolved(
  projectId: string,
  persistUserId: WorkspacePersistUserId = null,
  opts?: { companionBaseUrl?: string; limit?: number }
): Promise<{ items: WorkspaceProjectPreviewItem[]; totalEligible: number; rootAssetCount: number }> {
  const limit = opts?.limit ?? WORKSPACE_PROJECT_PREVIEW_LIMIT;
  const bundle = loadWorkflowBundle(projectId, persistUserId);
  const assets = bundle.assets ?? [];
  const items: WorkspaceProjectPreviewItem[] = [];
  const seenAssetIds = new Set<string>();
  let totalEligible = 0;
  let rootAssetCount = 0;

  for (const asset of assets) {
    if (!isRootPreviewCandidate(asset)) continue;
    if (asset.inRepository) continue;
    rootAssetCount += 1;
    if (!assetHasWorkspacePreviewRef(asset, assets)) continue;
    totalEligible += 1;
    const src = resolveWorkflowAssetPreviewSrc(asset, assets);
    if (src && workflowAssetLightboxRasterEligible(asset, src) && items.length < limit) {
      items.push({ assetId: asset.id, src });
      seenAssetIds.add(asset.id);
    }
  }

  const base = normalizeCompanionBaseUrl(String(opts?.companionBaseUrl || '').trim());
  if (!base || items.length >= limit) {
    return { items, totalEligible, rootAssetCount };
  }

  for (const asset of assets) {
    if (items.length >= limit) break;
    if (!isRootPreviewCandidate(asset)) continue;
    if (seenAssetIds.has(asset.id)) continue;
    const companionKey = resolveWorkflowAssetPreviewCompanionKey(asset, assets);
    if (!companionKey) continue;
    const got = await fetchWorkflowOriginalFromCompanionAsObjectUrl(base, projectId, companionKey);
    if (got.ok === false) continue;
    if (!workflowAssetLightboxRasterEligible(asset, got.objectUrl)) {
      URL.revokeObjectURL(got.objectUrl);
      continue;
    }
    items.push({ assetId: asset.id, src: got.objectUrl });
    seenAssetIds.add(asset.id);
  }

  return { items, totalEligible, rootAssetCount };
}
