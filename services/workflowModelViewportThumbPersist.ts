import type { WorkflowAsset } from '../types';
import {
  resolveWorkflowImageSlotIndex,
  workflowImagePreviewCompanionStorageKey,
} from './workflowCompanionAssets';
import { resolveWorkflowStepModelCompanionKeys, resolveWorkflowStepModelUrls } from './workflowStepModels';

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isSvgPlaceholder(src: string): boolean {
  return /^data:image\/svg\+xml/i.test(String(src || '').trim());
}

/** True when this step actually hosts a 3D model (manual import on original, or generate_3d result). */
export function workflowAssetHasModelAtStep(asset: WorkflowAsset, stepKeyRaw: string): boolean {
  const stepKey = clean(stepKeyRaw) || 'original';
  if (resolveWorkflowStepModelUrls(asset, stepKey).some(Boolean)) return true;
  if (resolveWorkflowStepModelCompanionKeys(asset, stepKey).some(Boolean)) return true;
  if (stepKey === 'original') {
    if ((asset.modelUrls || []).some((u) => clean(u))) return true;
    if ((asset.modelCompanionKeys || []).some((k) => clean(k))) return true;
  }
  return asset.resultMeta?.[stepKey]?.mediaKind === 'model3d';
}

/**
 * Apply a 3D viewport screenshot as a card poster for a result/model step.
 * Never writes into companion full-image keys.
 * Never replaces a photo-only `original` raster; model-at-original stores poster in `results.original`.
 */
export function patchAssetWithModelViewportThumb(
  asset: WorkflowAsset,
  variantIdRaw: string,
  thumbDataUrl: string,
  opts?: { force?: boolean; aspectRatio?: number }
): { asset: WorkflowAsset; changed: boolean; shouldPersistPreviewCompanion: boolean } {
  const variantId = clean(variantIdRaw) || 'original';
  const thumb = clean(thumbDataUrl);
  if (!thumb) {
    return { asset, changed: false, shouldPersistPreviewCompanion: false };
  }

  const aspectPatch =
    opts?.aspectRatio != null && asset.gridCardAspectRatio !== opts.aspectRatio
      ? { gridCardAspectRatio: opts.aspectRatio }
      : {};

  if (variantId === 'original') {
    // Photo-only cards: never replace source photo with a WebGL capture.
    if (!workflowAssetHasModelAtStep(asset, 'original')) {
      if (Object.keys(aspectPatch).length) {
        return {
          asset: { ...asset, ...aspectPatch },
          changed: true,
          shouldPersistPreviewCompanion: false,
        };
      }
      return { asset, changed: false, shouldPersistPreviewCompanion: false };
    }

    // Model lives on original (manual FBX/OBJ/GLB import): poster goes to results.original
    // so asset.original / originalCompanionKey stay untouched.
    const current = clean(asset.results?.original);
    const canWritePoster =
      Boolean(opts?.force) || !current || isSvgPlaceholder(current);
    if (!canWritePoster) {
      if (Object.keys(aspectPatch).length) {
        return {
          asset: { ...asset, ...aspectPatch },
          changed: true,
          shouldPersistPreviewCompanion: false,
        };
      }
      return { asset, changed: false, shouldPersistPreviewCompanion: false };
    }

    return {
      asset: {
        ...asset,
        ...aspectPatch,
        results: { ...(asset.results || {}), original: thumb },
        resultsPreviewRev: {
          ...(asset.resultsPreviewRev || {}),
          original: Date.now(),
        },
      },
      changed: true,
      shouldPersistPreviewCompanion: true,
    };
  }

  const current = clean(asset.results?.[variantId]);
  const canWritePoster =
    Boolean(opts?.force) || !current || isSvgPlaceholder(current);
  if (!canWritePoster) {
    return { asset, changed: false, shouldPersistPreviewCompanion: false };
  }

  return {
    asset: {
      ...asset,
      ...aspectPatch,
      results: { ...(asset.results || {}), [variantId]: thumb },
      resultsPreviewRev: {
        ...(asset.resultsPreviewRev || {}),
        [variantId]: Date.now(),
      },
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
  const assetIdClean = clean(assetId);
  const variantId = clean(variantIdRaw) || 'original';
  if (!assetIdClean) return null;
  // Allow original only when that step hosts a model (poster, not source photo).
  if (variantId === 'original') {
    if (!asset || !workflowAssetHasModelAtStep(asset, 'original')) return null;
  }
  const existing = clean(asset?.resultsPreviewCompanionKeys?.[variantId]);
  if (existing) return existing;
  const slotIndex = resolveWorkflowImageSlotIndex(asset?.resultOrder, variantId);
  return workflowImagePreviewCompanionStorageKey(assetIdClean, slotIndex, 'jpg');
}

/**
 * Card / grid poster for a model step: in-memory `results[step]` first, then
 * `resultsPreviewCompanionKeys` (image-thumb-*), never originalCompanionKey (image-full-*).
 * Companion URLs append `?v=resultsPreviewRev` so overwritten same-key files bust HTTP/img cache.
 */
export function resolveWorkflowModelStepPosterSrc(
  asset: WorkflowAsset,
  stepKeyRaw: string,
  toCompanionUrl?: ((companionKey: string) => string) | null
): string {
  const stepKey = clean(stepKeyRaw) || 'original';
  if (!workflowAssetHasModelAtStep(asset, stepKey)) return '';
  const raster = clean(asset.results?.[stepKey]);
  if (raster && !isSvgPlaceholder(raster)) return raster;
  const previewKey = clean(asset.resultsPreviewCompanionKeys?.[stepKey]);
  if (previewKey && toCompanionUrl) {
    const url = clean(toCompanionUrl(previewKey));
    if (!url) return '';
    const rev = Number(asset.resultsPreviewRev?.[stepKey]);
    if (Number.isFinite(rev) && rev > 0) {
      return `${url}${url.includes('?') ? '&' : '?'}v=${Math.floor(rev)}`;
    }
    return url;
  }
  return '';
}
