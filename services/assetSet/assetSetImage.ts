import {
  fetchWorkflowOriginalFromCompanionAsObjectUrl,
  imageSrcToDataUrlForCompanion,
  putWorkflowResultImageFromAnyUrl,
  putWorkflowResultImageToCompanion,
} from '../workflowCompanionAssets';
import type { StoryboardNamedAssetImageFields } from '../storyboardNamedAssetImage';

export function assetSetComponentImageCompanionKey(
  componentId: string,
  kind: 'crop' | 'sheet' | 'view',
  viewId?: string
): string {
  if (kind === 'view' && viewId) return `asset-set-view-${componentId}-${viewId}`;
  if (kind === 'sheet') return `asset-set-sheet-${componentId}`;
  return `asset-set-crop-${componentId}`;
}

/** 把逻辑 companionKey 稳定映射到伴侣 slot，避免同卡多图互相覆盖 slot=0 */
function companionKeyToSlotIndex(companionKey: string): number {
  const s = String(companionKey || '').trim();
  if (!s) return 0;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 900000 + 1;
}

export async function persistAssetSetImageFields(params: {
  dataUrl: string;
  tableAssetId: string;
  companionKey: string;
  companionBaseUrl: string;
  companionProjectId: string;
}): Promise<StoryboardNamedAssetImageFields> {
  const dataUrl = String(params.dataUrl || '').trim();
  if (!dataUrl) {
    return {};
  }
  const base = String(params.companionBaseUrl || '').trim();
  const pid = String(params.companionProjectId || '').trim();
  if (!base || !pid) {
    return { image: dataUrl };
  }
  const put = await putWorkflowResultImageToCompanion(
    base,
    pid,
    params.tableAssetId,
    params.companionKey,
    dataUrl,
    { slotIndex: companionKeyToSlotIndex(params.companionKey) }
  );
  if (!put.ok) {
    return { image: dataUrl };
  }
  const got = await fetchWorkflowOriginalFromCompanionAsObjectUrl(base, pid, put.key);
  if (got.ok) {
    return { image: got.objectUrl, imageCompanionKey: put.key };
  }
  return { image: dataUrl, imageCompanionKey: put.key };
}

/**
 * 生成结果优先原样落盘（本机伴侣，支持 data/blob/https）。
 * 无伴侣或写入失败时：https 原链直存；其它再 compress 兜底，避免巨型 data URL 撑 JSON。
 */
export async function persistAssetSetGeneratedImageFields(params: {
  dataUrl: string;
  tableAssetId: string;
  companionKey: string;
  companionBaseUrl: string;
  companionProjectId: string;
  compress: (dataUrl: string) => Promise<string>;
}): Promise<StoryboardNamedAssetImageFields> {
  const original = String(params.dataUrl || '').trim();
  if (!original) return {};

  const base = String(params.companionBaseUrl || '').trim();
  const pid = String(params.companionProjectId || '').trim();
  if (base && pid) {
    const put = await putWorkflowResultImageFromAnyUrl(
      base,
      pid,
      params.tableAssetId,
      params.companionKey,
      original,
      { slotIndex: companionKeyToSlotIndex(params.companionKey) }
    );
    if (put.ok) {
      const got = await fetchWorkflowOriginalFromCompanionAsObjectUrl(base, pid, put.key);
      if (got.ok) {
        return { image: got.objectUrl, imageCompanionKey: put.key };
      }
      return { image: original, imageCompanionKey: put.key };
    }
  }

  // 远程图链：不经 canvas 再压，下载仍可拿原图（至链接失效）
  if (/^https?:\/\//i.test(original)) {
    return { image: original };
  }

  // blob / data：无伴侣时压到可嵌入工作区的大小
  const material =
    /^blob:/i.test(original) ? (await imageSrcToDataUrlForCompanion(original)) || original : original;
  const compressed = await params.compress(material);
  return persistAssetSetImageFields({
    dataUrl: compressed,
    tableAssetId: params.tableAssetId,
    companionKey: params.companionKey,
    companionBaseUrl: params.companionBaseUrl,
    companionProjectId: params.companionProjectId,
  });
}

export async function resolveAssetSetImageDataUrl(
  fields: StoryboardNamedAssetImageFields | undefined,
  companionBaseUrl: string,
  companionProjectId: string
): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string }> {
  const display = String(fields?.image || '').trim();
  if (display) {
    const dataUrl = await imageSrcToDataUrlForCompanion(display);
    if (dataUrl) return { ok: true, dataUrl };
  }
  const companionKey = String(fields?.imageCompanionKey || '').trim();
  if (!companionKey) {
    return { ok: false, error: '图片无法加载' };
  }
  const base = String(companionBaseUrl || '').trim();
  const pid = String(companionProjectId || '').trim();
  if (!base || !pid) {
    return { ok: false, error: '请连接本机伴侣后重试' };
  }
  const got = await fetchWorkflowOriginalFromCompanionAsObjectUrl(base, pid, companionKey);
  if (got.ok === false) {
    return { ok: false, error: '图片无法从伴侣加载' };
  }
  const dataUrl = await imageSrcToDataUrlForCompanion(got.objectUrl);
  URL.revokeObjectURL(got.objectUrl);
  if (!dataUrl) {
    return { ok: false, error: '图片无法解析' };
  }
  return { ok: true, dataUrl };
}
