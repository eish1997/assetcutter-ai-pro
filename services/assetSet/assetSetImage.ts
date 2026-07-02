import {
  fetchWorkflowOriginalFromCompanionAsObjectUrl,
  imageSrcToDataUrlForCompanion,
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
    dataUrl
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
