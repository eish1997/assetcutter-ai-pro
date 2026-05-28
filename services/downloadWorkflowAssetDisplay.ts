import type { WorkflowAsset } from '../types';
import { fetchCompanionAssetForDownload } from './companionClient/storage';
import { isGroupAsset } from './groupHelpers';
import { fileExtensionForImageDataUrl } from './imageDataUrl';
import { downloadWorkflowStepModelSlot } from './downloadModelFile';
import {
  fetchCompanionAssetAsDataUrl,
  imageSrcToDataUrlForCompanion,
} from './workflowCompanionAssets';
import { downloadBlobPreferWorkbench } from './workbenchDownloadBridge';
import { ensureDownloadFilenameExtension } from './downloadFilename';
import {
  resolveWorkflowStepModelCompanionKeys,
  resolveWorkflowStepModelFormats,
  resolveWorkflowStepModelUrls,
} from './workflowStepModels';
import { isWorkflowTextAsset } from './workflowTextAsset';
import type { WorkflowDragSource } from './workflowDragPipeline';

export type DownloadWorkflowAssetDisplayDeps = {
  getAssetDisplayImage: (asset: WorkflowAsset) => string;
  getAssetDisplayText: (asset: WorkflowAsset) => string;
  companionBaseUrl?: string | null;
  companionProjectId?: string | null;
  tripoApiKey?: string | null;
};

export type DownloadWorkflowAssetDisplayResult =
  | { ok: true; kind: 'text' | 'image' | 'model'; filename: string }
  | { ok: false; reason: string };

function sanitizeFilenameBase(name: string): string {
  const base = String(name || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 72);
  return base || 'asset';
}

function assetFilenameBase(asset: WorkflowAsset): string {
  const title = (asset.textTitle || asset.groupLabel || '').trim();
  if (title) return sanitizeFilenameBase(title);
  return `workflow-${asset.id.slice(0, 8)}`;
}

async function triggerTextDownload(
  text: string,
  filenameBase: string
): Promise<DownloadWorkflowAssetDisplayResult> {
  const ok = await downloadBlobPreferWorkbench(
    new Blob([text], { type: 'text/plain;charset=utf-8' }),
    `${filenameBase}.txt`,
    { noticeTitle: '文字已保存' }
  );
  if (!ok) return { ok: false, reason: '已取消下载' };
  return { ok: true, kind: 'text', filename: `${filenameBase}.txt` };
}

function textAssetShowsRasterImage(asset: WorkflowAsset, imageSrc: string): boolean {
  if (!imageSrc.trim()) return false;
  if (imageSrc.includes('image/svg+xml') && isWorkflowTextAsset(asset)) {
    const dk = (asset.displayKey || 'original').trim() || 'original';
    if (dk === 'original') return false;
  }
  return true;
}

/** 当前展示版本在伴侣卷中的原图键（优先于内存里的缩略/占位串） */
export function workflowCompanionKeyForDisplay(
  asset: WorkflowAsset,
  displayKey?: string
): string {
  const dk = (displayKey || asset.displayKey || 'original').trim() || 'original';
  if (dk === 'original') return String(asset.originalCompanionKey || '').trim();
  return String(asset.resultsCompanionKeys?.[dk] || '').trim();
}

async function saveWorkflowAssetImageBlob(
  blob: Blob,
  filename: string
): Promise<DownloadWorkflowAssetDisplayResult> {
  const ok = await downloadBlobPreferWorkbench(blob, filename, { noticeTitle: '图片已保存' });
  if (!ok) return { ok: false, reason: '已取消下载' };
  return { ok: true, kind: 'image', filename };
}

async function saveWorkflowAssetImageDataUrl(
  dataUrl: string,
  nameBase: string
): Promise<DownloadWorkflowAssetDisplayResult> {
  const normalized = (await imageSrcToDataUrlForCompanion(dataUrl)) || dataUrl;
  try {
    const res = await fetch(normalized);
    const blob = await res.blob();
    const ext = fileExtensionForImageDataUrl(normalized);
    const filename = /\.[a-z0-9]{2,8}$/i.test(nameBase) ? nameBase : `${nameBase}.${ext}`;
    return saveWorkflowAssetImageBlob(blob, filename);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

async function downloadWorkflowAssetImageFull(
  asset: WorkflowAsset,
  deps: DownloadWorkflowAssetDisplayDeps,
  nameBase: string
): Promise<DownloadWorkflowAssetDisplayResult> {
  const dk = (asset.displayKey || 'original').trim() || 'original';
  const base = String(deps.companionBaseUrl || '').trim();
  const pid = String(deps.companionProjectId || '').trim();
  const companionKey = workflowCompanionKeyForDisplay(asset, dk);

  if (companionKey && base && pid) {
    const fromCompanion = await fetchCompanionAssetForDownload(base, pid, companionKey, {
      filenameHint: nameBase,
    });
    if (fromCompanion.ok) {
      const filename = await ensureDownloadFilenameExtension(
        fromCompanion.data.filename || nameBase,
        { mime: fromCompanion.data.mime, blob: fromCompanion.data.blob }
      );
      return saveWorkflowAssetImageBlob(fromCompanion.data.blob, filename);
    }
    const dataUrl = await fetchCompanionAssetAsDataUrl(base, pid, companionKey);
    if (dataUrl) {
      return saveWorkflowAssetImageDataUrl(dataUrl, nameBase);
    }
  }

  const display = deps.getAssetDisplayImage(asset).trim();
  if (!display) return { ok: false, reason: '无可下载的预览内容' };

  return saveWorkflowAssetImageDataUrl(display, nameBase);
}

/** 下载单个资产当前展示版本（文字 / 图片 / 3D 模型等）。 */
export async function downloadWorkflowAssetDisplay(
  asset: WorkflowAsset,
  deps: DownloadWorkflowAssetDisplayDeps
): Promise<DownloadWorkflowAssetDisplayResult> {
  const nameBase = assetFilenameBase(asset);
  const dk = asset.displayKey;
  const modelUrls = resolveWorkflowStepModelUrls(asset, dk);
  if (modelUrls.length > 0) {
    const urls = modelUrls;
    const keys = resolveWorkflowStepModelCompanionKeys(asset, dk);
    const formats = resolveWorkflowStepModelFormats(asset, dk);
    const slotIndex = 0;
    const format = formats[slotIndex] || 'glb';
    try {
      const r = await downloadWorkflowStepModelSlot({
        assetId: asset.id,
        resultKey: dk,
        slotIndex,
        url: urls[slotIndex] || '',
        companionKey: keys[slotIndex] || '',
        companionBaseUrl: deps.companionBaseUrl ?? null,
        companionProjectId: deps.companionProjectId ?? null,
        fileNameHint: `${nameBase}.${format}`,
        tripoApiKey: deps.tripoApiKey ?? null,
      });
      return { ok: true, kind: 'model', filename: r.filename };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }

  const imageSrc = deps.getAssetDisplayImage(asset).trim();
  if (isWorkflowTextAsset(asset) && !textAssetShowsRasterImage(asset, imageSrc)) {
    const body = deps.getAssetDisplayText(asset);
    const title = (asset.textTitle || '').trim();
    const text = title ? `${title}\n\n${body}` : body;
    if (!text.trim()) return { ok: false, reason: '文字内容为空' };
    return triggerTextDownload(text, nameBase);
  }

  if (!imageSrc) return { ok: false, reason: '无可下载的预览内容' };
  return downloadWorkflowAssetImageFull(asset, deps, nameBase);
}

export function collectWorkflowAssetIdsFromDragSources(
  sources: WorkflowDragSource[],
  assets: WorkflowAsset[],
  ensureGroupItemsAsAssets: (
    prev: WorkflowAsset[],
    groupAssetId: string,
    itemIndexes: number[]
  ) => { nextAssets: WorkflowAsset[]; assetIds: string[] }
): string[] {
  const ids: string[] = [];
  for (const src of sources) {
    if (src.kind === 'root') {
      for (const id of src.assetIds) {
        const t = id.trim();
        if (t && !ids.includes(t)) ids.push(t);
      }
      continue;
    }
    const { assetIds } = ensureGroupItemsAsAssets(assets, src.groupAssetId, src.itemIndexes);
    for (const id of assetIds) {
      const t = id.trim();
      if (t && !ids.includes(t)) ids.push(t);
    }
  }
  return ids;
}

export async function downloadWorkflowAssetsByIds(
  assetIds: string[],
  assets: WorkflowAsset[],
  deps: DownloadWorkflowAssetDisplayDeps,
  options?: { delayMs?: number }
): Promise<{ ok: number; failed: Array<{ assetId: string; reason: string }> }> {
  const delayMs = options?.delayMs ?? 280;
  let ok = 0;
  const failed: Array<{ assetId: string; reason: string }> = [];
  const uniq = [...new Set(assetIds.map((id) => id.trim()).filter(Boolean))];

  for (let i = 0; i < uniq.length; i += 1) {
    const id = uniq[i]!;
    const asset = assets.find((a) => a.id === id);
    if (!asset) {
      failed.push({ assetId: id, reason: '资产不存在' });
      continue;
    }
    if (isGroupAsset(asset)) {
      const r = await downloadWorkflowAssetImageFull(asset, deps, assetFilenameBase(asset));
      if (r.ok) ok += 1;
      else failed.push({ assetId: id, reason: r.reason });
    } else {
      const r = await downloadWorkflowAssetDisplay(asset, deps);
      if (r.ok) ok += 1;
      else failed.push({ assetId: id, reason: r.reason });
    }
    if (i < uniq.length - 1 && delayMs > 0) {
      await new Promise((res) => window.setTimeout(res, delayMs));
    }
  }

  return { ok, failed };
}
