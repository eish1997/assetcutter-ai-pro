/**
 * Open-folder / reveal: ensure a durable companion key exists for the current display slot.
 * Text birth shells keep images in results — never forge originalCompanionKey for them.
 */

import type { WorkflowAsset } from '../types';
import { normalizeCompanionBaseUrl } from './companionLocalPrefs';
import {
  putWorkflowOriginalImageFromAnyUrl,
  putWorkflowResultImageFromAnyUrl,
  putWorkflowResultMediaFromAnyUrl,
  resolveWorkflowImageSlotIndex,
} from './workflowCompanionAssets';
import { resolveActiveVariantCompanionKey } from './workflowMediaRef';
import { isWorkflowTextAsset, resolveWorkflowDisplaySlot } from './workflowTextAsset';

export function workflowAssetHasPersistableOpenFolderRaster(asset: WorkflowAsset): boolean {
  const slot = resolveWorkflowDisplaySlot(asset);
  if (slot.modality !== 'image' && slot.modality !== 'video') return false;
  return Boolean(String(slot.imageSrc || '').trim());
}

/**
 * Sync menu enablement: keyed handle, or companion+project ready and current slot has a raster we can persist.
 */
export function canAttemptOpenWorkflowAssetFolder(input: {
  projectId?: string | null;
  companionBaseUrl?: string | null;
  hasCompanionKey: boolean;
  asset: WorkflowAsset;
}): boolean {
  if (input.hasCompanionKey) return true;
  const projectId = String(input.projectId || '').trim();
  if (!projectId) return false;
  if (input.companionBaseUrl === null) return false;
  const base = normalizeCompanionBaseUrl(String(input.companionBaseUrl || '').trim());
  if (!base) return false;
  return workflowAssetHasPersistableOpenFolderRaster(input.asset);
}

export type EnsureCompanionForRevealResult =
  | { ok: true; asset: WorkflowAsset; companionKey: string; wrote: boolean }
  | { ok: false; error: string; asset: WorkflowAsset };

/**
 * If the current display slot has no companion key but has a raster URL, PUT/import then return patched asset.
 */
export async function ensureWorkflowAssetCompanionKeyForReveal(input: {
  asset: WorkflowAsset;
  projectId: string;
  companionBaseUrl: string;
}): Promise<EnsureCompanionForRevealResult> {
  const asset = input.asset;
  const projectId = String(input.projectId || '').trim();
  const base = normalizeCompanionBaseUrl(String(input.companionBaseUrl || '').trim());
  if (!projectId) return { ok: false, error: 'missing_project', asset };
  if (!base) return { ok: false, error: 'companion_offline', asset };

  const slot = resolveWorkflowDisplaySlot(asset);
  const displayKey = slot.displayKey;
  const existing = resolveActiveVariantCompanionKey(asset, displayKey);
  if (existing) {
    return { ok: true, asset, companionKey: existing, wrote: false };
  }

  const src = String(slot.imageSrc || '').trim();
  if (!src || (slot.modality !== 'image' && slot.modality !== 'video')) {
    return { ok: false, error: 'no_persistable_raster', asset };
  }

  // Text birth shell: original is text — production rasters live in results only.
  if (displayKey === 'original') {
    if (isWorkflowTextAsset(asset)) {
      return { ok: false, error: 'text_original_not_raster', asset };
    }
    const put = await putWorkflowOriginalImageFromAnyUrl(base, projectId, asset.id, src);
    if (put.ok === false) return { ok: false, error: put.error, asset };
    const next = { ...asset, originalCompanionKey: put.key };
    return { ok: true, asset: next, companionKey: put.key, wrote: true };
  }

  if (slot.modality === 'video') {
    const put = await putWorkflowResultMediaFromAnyUrl(base, projectId, asset.id, displayKey, src, {
      fallbackMime: 'video/mp4',
    });
    if (put.ok === false) return { ok: false, error: put.error, asset };
    const next: WorkflowAsset = {
      ...asset,
      resultsCompanionKeys: { ...(asset.resultsCompanionKeys || {}), [displayKey]: put.key },
    };
    return { ok: true, asset: next, companionKey: put.key, wrote: true };
  }

  const slotIndex = resolveWorkflowImageSlotIndex(asset.resultOrder, displayKey);
  const put = await putWorkflowResultImageFromAnyUrl(base, projectId, asset.id, displayKey, src, {
    slotIndex,
  });
  if (put.ok === false) return { ok: false, error: put.error, asset };
  const next: WorkflowAsset = {
    ...asset,
    resultsCompanionKeys: { ...(asset.resultsCompanionKeys || {}), [displayKey]: put.key },
    ...(put.previewKey
      ? {
          resultsPreviewCompanionKeys: {
            ...(asset.resultsPreviewCompanionKeys || {}),
            [displayKey]: put.previewKey,
          },
        }
      : {}),
  };
  return { ok: true, asset: next, companionKey: put.key, wrote: true };
}
