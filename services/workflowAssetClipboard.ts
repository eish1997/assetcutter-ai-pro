import { workflowSafeImgSrc } from './workflowImageDisplay';
import { serializeWorkflowAssetClipboardText } from './workflowDragPipeline';

export type CopyWorkflowAssetClipboardOutcome = 'ok' | 'no-image' | 'failed';

/** @deprecated */
export type CopyWorkflowAssetOriginalOutcome = CopyWorkflowAssetClipboardOutcome;

/**
 * 复制资产原图到剪贴板（纯图片，无工作区引用标记），可粘贴到任意位置。
 */
export async function copyWorkflowAssetOriginalImageToClipboard(input: {
  imageSrc: string;
}): Promise<CopyWorkflowAssetClipboardOutcome> {
  const src = workflowSafeImgSrc(String(input.imageSrc || '').trim());
  if (!src.trim()) return 'no-image';

  try {
    const res = await fetch(src);
    const blob = await res.blob();
    const imageType = blob.type?.startsWith('image/') ? blob.type : 'image/png';
    await navigator.clipboard.write([new ClipboardItem({ [imageType]: blob })]);
    return 'ok';
  } catch {
    return 'failed';
  }
}

/** @deprecated 使用 copyWorkflowAssetOriginalImageToClipboard */
export async function copyWorkflowAssetImageToClipboard(input: {
  assetId: string;
  imageSrc: string;
}): Promise<CopyWorkflowAssetClipboardOutcome> {
  return copyWorkflowAssetOriginalImageToClipboard({ imageSrc: input.imageSrc });
}

/** @deprecated 使用 copyWorkflowAssetOriginalImageToClipboard */
export async function copyWorkflowAssetOriginalToClipboard(input: {
  assetId: string;
  originalSrc: string;
}): Promise<CopyWorkflowAssetClipboardOutcome> {
  return copyWorkflowAssetOriginalImageToClipboard({ imageSrc: input.originalSrc });
}

/** 仅复制资产 ID 引用标记；粘贴到快捷输入栏时解析为引用，不新建卡片。 */
export async function copyWorkflowAssetIdToClipboard(input: {
  assetId: string;
}): Promise<Exclude<CopyWorkflowAssetClipboardOutcome, 'no-image'>> {
  const assetId = input.assetId.trim();
  if (!assetId) return 'failed';
  const marker = serializeWorkflowAssetClipboardText([assetId]);
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(marker);
      return 'ok';
    }
  } catch {
    /* fall through */
  }
  return 'failed';
}

/** 将工作区图片地址解析为对话输入可用的 data URL */
export async function resolveWorkflowAssetImageDataUrl(imageSrc: string): Promise<string | null> {
  const src = workflowSafeImgSrc(String(imageSrc || '').trim());
  if (!src) return null;
  if (src.startsWith('data:')) return src;
  try {
    const res = await fetch(src);
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('read failed'));
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}
