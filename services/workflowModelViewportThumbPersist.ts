import type { WorkflowAsset } from '../types';
import {
  resolveWorkflowImageSlotIndex,
  workflowImagePreviewCompanionStorageKey,
} from './workflowCompanionAssets';

/**
 * Apply a 3D viewport screenshot as a card poster for a result/model step.
 * Never writes into `original` (source photo) or companion full-image keys.
 */
export function patchAssetWithModelViewportThumb(
  asset: WorkflowAsset,
  variantIdRaw: string,
  thumbDataUrl: string,
  opts?: { force?: boolean; aspectRatio?: number }
): { asset: WorkflowAsset; changed: boolean; shouldPersistPreviewCompanion: boolean } {
  const variantId = String(variantIdRaw || '').trim() || 'original';
  const thumb = String(thumbDataUrl || '').trim();
  if (!thumb) {
    return { asset, changed: false, shouldPersistPreviewCompanion: false };
  }

  // Source photo / primary raster must never be replaced by a WebGL capture.
  if (variantId === 'original') {
    if (opts?.aspectRatio != null && asset.gridCardAspectRatio !== opts.aspectRatio) {
      return {
        asset: { ...asset, gridCardAspectRatio: opts.aspectRatio },
        changed: true,
        shouldPersistPreviewCompanion: false,
      };
    }
    return { asset, changed: false, shouldPersistPreviewCompanion: false };
  }

  const current = String(asset.results?.[variantId] || '').trim();
  const canWritePoster =
    Boolean(opts?.force) || !current || /^data:image\/svg\+xml/i.test(current);
  if (!canWritePoster) {
    return { asset, changed: false, shouldPersistPreviewCompanion: false };
  }

  return {
    asset: {
      ...asset,
      results: { ...(asset.results || {}), [variantId]: thumb },
      ...(opts?.aspectRatio != null ? { gridCardAspectRatio: opts.aspectRatio } : {}),
    },
    changed: true,
    shouldPersistPreviewCompanion: true,
  };
}

/** Preview/thumb companion object only — never originalCompanionKey / resultsCompanionKeys. */
export function resolveModelViewportThumbPreviewCompanionKey(
  asset: WorkflowAsset | null | undefined,
  assetId: string,
  variantIdRaw: string
): string | null {
  const assetIdClean = String(assetId || '').trim();
  const variantId = String(variantIdRaw || '').trim() || 'original';
  if (!assetIdClean || variantId === 'original') return null;
  const existing = String(asset?.resultsPreviewCompanionKeys?.[variantId] || '').trim();
  if (existing) return existing;
  const slotIndex = resolveWorkflowImageSlotIndex(asset?.resultOrder, variantId);
  return workflowImagePreviewCompanionStorageKey(assetIdClean, slotIndex, 'jpg');
}
