import type { WorkflowAsset } from '../types';
import { PREVIEW_THUMB_MAX_DATA_URL_CHARS } from './workflowImageThumb';
import { workflowAssetHasModelAtStep } from './workflowModelViewportThumbPersist';
import { healWorkflowAssetDisplayKeyIfEmpty } from './workflowTextAsset';

export function isOversizedInlineGridPreviewSrc(src: string): boolean {
  const s = String(src || '').trim();
  return /^data:/i.test(s) && s.length > PREVIEW_THUMB_MAX_DATA_URL_CHARS;
}

export function isCompanionImageFullHttpSrc(src: string): boolean {
  return /(?:\/|%2F)image-full-\d+-/i.test(String(src || ''));
}

/**
 * 网格卡面：优先用已落盘的 image-thumb，避免把超大 data URL / image-full 送进渐进缩略后变空卡。
 * 灯箱仍应使用完整 displaySrc。
 */
export function pickWorkflowGridCardPreviewSrc(opts: {
  displaySrc: string;
  previewCompanionUrl?: string;
}): string {
  const display = String(opts.displaySrc || '').trim();
  const preview = String(opts.previewCompanionUrl || '').trim();
  if (preview && (isOversizedInlineGridPreviewSrc(display) || isCompanionImageFullHttpSrc(display) || !display)) {
    return preview;
  }
  return display || preview;
}

export function resolveWorkflowAssetGridPreviewCompanionKey(asset: WorkflowAsset): string {
  const healed = healWorkflowAssetDisplayKeyIfEmpty(asset);
  const dk = String(healed.displayKey || 'original').trim() || 'original';
  return String(healed.resultsPreviewCompanionKeys?.[dk] || '').trim();
}

export function mergeWorkflowOriginalCompanionPersist(
  asset: WorkflowAsset,
  put: { key: string; previewKey?: string }
): WorkflowAsset {
  const next: WorkflowAsset = { ...asset, originalCompanionKey: put.key };
  const previewKey = String(put.previewKey || '').trim();
  if (!previewKey) return next;
  if (workflowAssetHasModelAtStep(asset, 'original')) return next;
  return {
    ...next,
    resultsPreviewCompanionKeys: {
      ...(asset.resultsPreviewCompanionKeys || {}),
      original: previewKey,
    },
  };
}
