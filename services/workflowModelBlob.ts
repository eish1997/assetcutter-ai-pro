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

function revokeBlobUrlIfOrphaned(url: string, stillReferenced: boolean): void {
  const u = String(url || '').trim();
  if (!isBlobModelUrl(u)) return;
  if (stillReferenced) return;
  try {
    URL.revokeObjectURL(u);
  } catch {
    /* ignore */
  }
}

function assetReferencesBlobUrl(a: WorkflowAsset, url: string): boolean {
  const u = String(url || '').trim();
  if (!u) return false;
  if ((a.modelUrls || []).some((x) => String(x || '').trim() === u)) return true;
  for (const arr of Object.values(a.stepModelUrls || {})) {
    if ((arr || []).some((x) => String(x || '').trim() === u)) return true;
  }
  return false;
}

/** 当某 blob URL 已无任何资产引用时释放，避免重复 revoke（如复制卡片共享同一 blob）。 */
export function revokeWorkflowModelBlobUrlsIfOrphaned(url: string, assetsReferencing: WorkflowAsset[]): void {
  const u = String(url || '').trim();
  if (!isBlobModelUrl(u)) return;
  const still = assetsReferencing.some((a) => assetReferencesBlobUrl(a, u));
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
  for (const arr of Object.values(removed.stepModelUrls || {})) {
    for (const raw of arr || []) {
      revokeWorkflowModelBlobUrlsIfOrphaned(String(raw || ''), assetsAfterRemoval);
    }
  }
  const orig = String(removed.original || '').trim();
  if (orig) {
    const stillOrig = assetsAfterRemoval.some((a) => String(a.original || '').trim() === orig);
    revokeBlobUrlIfOrphaned(orig, stillOrig);
  }
  if (removed.results) {
    for (const v of Object.values(removed.results)) {
      const u = String(v || '').trim();
      if (!u) continue;
      const still = assetsAfterRemoval.some((a) =>
        Object.values(a.results || {}).some((x) => String(x || '').trim() === u)
      );
      revokeBlobUrlIfOrphaned(u, still);
    }
  }
}

/** 探测模型预览/下载 URL 在当前文档内是否仍可读取 */
export async function isWorkflowModelUrlReadable(url: string): Promise<boolean> {
  const u = String(url || '').trim();
  if (!u) return false;
  if (/^blob:/i.test(u) || /^data:/i.test(u) || /^https?:\/\//i.test(u)) {
    try {
      const r = await fetch(u);
      return r.ok;
    } catch {
      return false;
    }
  }
  return false;
}

/** 有伴侣键时，槽位是否可能需要从伴侣 hydrate（含空 url、失效 blob） */
export function workflowModelSlotMayNeedCompanionHydrate(url: string, companionKey: string): boolean {
  const ck = String(companionKey || '').trim();
  if (!ck) return false;
  const u = String(url ?? '').trim();
  if (!u) return true;
  if (!/^blob:/i.test(u) && !/^https?:\/\//i.test(u) && !u.startsWith('data:')) return true;
  if (/^blob:/i.test(u)) return true;
  return false;
}

/** hydrate 前：若已有可读 url 则跳过伴侣拉取 */
export async function shouldKeepExistingWorkflowModelSlotUrl(
  url: string,
  _companionKey: string
): Promise<boolean> {
  const u = String(url ?? '').trim();
  if (!u) return false;
  if (/^https?:\/\//i.test(u) || u.startsWith('data:')) return true;
  if (/^blob:/i.test(u)) {
    return await isWorkflowModelUrlReadable(u);
  }
  return false;
}
