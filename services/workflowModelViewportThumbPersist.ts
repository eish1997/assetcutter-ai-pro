import type { WorkflowAsset } from '../types';
import {
  parseCanonicalCompanionObjectKey,
  resolveWorkflowImageSlotIndex,
  workflowImageCompanionStorageKey,
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
 * Apply a 3D viewport screenshot as an in-memory poster for a result/model step.
 * Companion full/thumb writes happen in persist (same capture, paired keys).
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

function posterSlotCollidesWithOriginal(
  originalCompanionKey: string,
  assetId: string,
  slot: number
): boolean {
  const orig = clean(originalCompanionKey);
  if (!orig) return false;
  const parsed = parseCanonicalCompanionObjectKey(orig);
  if (parsed) {
    return parsed.assetId === assetId && parsed.mediaKind === 'image' && parsed.role === 'full' && parsed.slot === slot;
  }
  if (orig.startsWith(`${assetId}/image-full-${slot}-`)) return true;
  if (slot === 0 && /\/original(-image|-video)?/i.test(orig)) return true;
  return orig === workflowImageCompanionStorageKey(assetId, slot, 'png');
}

/**
 * Slot for the 3D viewport poster pair (image-full + image-thumb).
 * Reuses an existing step poster slot; never the source-photo `originalCompanionKey` slot.
 */
export function resolveModelViewportPosterSlot(
  asset: WorkflowAsset | null | undefined,
  assetId: string,
  variantIdRaw: string
): number | null {
  const assetIdClean = clean(assetId);
  const variantId = clean(variantIdRaw) || 'original';
  if (!assetIdClean) return null;
  if (variantId === 'original' && (!asset || !workflowAssetHasModelAtStep(asset, 'original'))) return null;

  const orig = clean(asset?.originalCompanionKey);
  const existingFull = clean(asset?.resultsCompanionKeys?.[variantId]);
  if (existingFull && existingFull !== orig) {
    const parsed = parseCanonicalCompanionObjectKey(existingFull);
    if (parsed?.mediaKind === 'image') return parsed.slot;
  }
  const existingThumb = clean(asset?.resultsPreviewCompanionKeys?.[variantId]);
  if (existingThumb) {
    const parsed = parseCanonicalCompanionObjectKey(existingThumb);
    if (parsed?.mediaKind === 'image') return parsed.slot;
  }

  let slot = resolveWorkflowImageSlotIndex(asset?.resultOrder, variantId);
  if (posterSlotCollidesWithOriginal(orig, assetIdClean, slot)) slot += 1;
  return slot;
}

export function resolveModelViewportPosterFullCompanionKey(
  asset: WorkflowAsset | null | undefined,
  assetId: string,
  variantIdRaw: string,
  ext = 'png'
): string | null {
  const slot = resolveModelViewportPosterSlot(asset, assetId, variantIdRaw);
  if (slot == null) return null;
  const orig = clean(asset?.originalCompanionKey);
  const existing = clean(asset?.resultsCompanionKeys?.[clean(variantIdRaw) || 'original']);
  if (existing && existing !== orig) return existing;
  const key = workflowImageCompanionStorageKey(assetId, slot, ext);
  if (key === orig || posterSlotCollidesWithOriginal(orig, clean(assetId), slot)) return null;
  return key;
}

/** Preview/thumb companion object — paired with poster full; never `originalCompanionKey`. */
export function resolveModelViewportThumbPreviewCompanionKey(
  asset: WorkflowAsset | null | undefined,
  assetId: string,
  variantIdRaw: string
): string | null {
  const assetIdClean = clean(assetId);
  const variantId = clean(variantIdRaw) || 'original';
  if (!assetIdClean) return null;
  if (variantId === 'original') {
    if (!asset || !workflowAssetHasModelAtStep(asset, 'original')) return null;
  }
  const existing = clean(asset?.resultsPreviewCompanionKeys?.[variantId]);
  if (existing) return existing;
  const slotIndex = resolveModelViewportPosterSlot(asset, assetIdClean, variantId);
  if (slotIndex == null) return null;
  return workflowImagePreviewCompanionStorageKey(assetIdClean, slotIndex, 'jpg');
}

export function planModelViewportPosterPersist(
  asset: WorkflowAsset | null | undefined,
  assetId: string,
  variantIdRaw: string,
  ext = 'png'
): { slot: number; fullKey: string | null; previewKey: string; writeFull: boolean } | null {
  const slot = resolveModelViewportPosterSlot(asset, assetId, variantIdRaw);
  const previewKey = resolveModelViewportThumbPreviewCompanionKey(asset, assetId, variantIdRaw);
  if (slot == null || !previewKey) return null;
  const fullKey = resolveModelViewportPosterFullCompanionKey(asset, assetId, variantIdRaw, ext);
  return { slot, fullKey, previewKey, writeFull: Boolean(fullKey) };
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
