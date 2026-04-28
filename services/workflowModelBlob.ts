import type { WorkflowAsset } from '../types';

/** 本地拖入的 3D 预览大小上限（字节）。可用 `VITE_WORKFLOW_LOCAL_MODEL_PREVIEW_MAX_MB` 覆盖，默认 80MB。 */
const parsedMb = Number(String(import.meta.env?.VITE_WORKFLOW_LOCAL_MODEL_PREVIEW_MAX_MB || '').trim());
const fallbackMb = 80;
const mb = Number.isFinite(parsedMb) && parsedMb > 0 ? parsedMb : fallbackMb;
export const WORKFLOW_LOCAL_MODEL_PREVIEW_MAX_BYTES = Math.floor(mb * 1024 * 1024);

export function workflowLocalModelFileExceedsPreviewLimit(size: number): boolean {
  return size > WORKFLOW_LOCAL_MODEL_PREVIEW_MAX_BYTES;
}

export function formatWorkflowModelPreviewLimitLabel(): string {
  return `${Math.round(WORKFLOW_LOCAL_MODEL_PREVIEW_MAX_BYTES / (1024 * 1024))}MB`;
}

function isBlobModelUrl(url: string): boolean {
  return /^blob:/i.test(url.trim());
}

/** 当某 blob URL 已无任何资产引用时释放，避免重复 revoke（如复制卡片共享同一 blob）。 */
export function revokeWorkflowModelBlobUrlsIfOrphaned(url: string, assetsReferencing: WorkflowAsset[]): void {
  const u = String(url || '').trim();
  if (!isBlobModelUrl(u)) return;
  const still = assetsReferencing.some((a) =>
    (a.modelUrls || []).some((x) => String(x || '').trim() === u)
  );
  if (still) return;
  try {
    URL.revokeObjectURL(u);
  } catch {
    /* ignore */
  }
}

export function revokeWorkflowModelBlobUrlsAfterAssetRemoved(
  removed: WorkflowAsset,
  assetsAfterRemoval: WorkflowAsset[]
): void {
  for (const raw of removed.modelUrls || []) {
    revokeWorkflowModelBlobUrlsIfOrphaned(String(raw || ''), assetsAfterRemoval);
  }
}
