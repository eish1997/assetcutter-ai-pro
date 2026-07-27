/**
 * 3D PBR 贴图右键动作桥：Viewer 内发起，WorkflowSection 执行「加入输入框 / 打开文件夹」。
 */

import type { WorkflowModelPbrSlot } from './workflowModelPbrEdits';

export const WORKFLOW_MODEL_PBR_TEXTURE_ACTION_EVENT = 'asset-preview:model3d-pbr-texture-action';

export type WorkflowModelPbrTextureAction =
  | {
      action: 'add-to-compose';
      /** 宿主 3D 资产（写回目标） */
      assetId: string;
      /** 正式贴图资产；有则直接入快捷栏，不再复制 dataUrl 建新卡 */
      textureAssetId?: string;
      dataUrl?: string;
      fileName?: string;
      slots: WorkflowModelPbrSlot[];
      materialIds?: string[];
      textureLabel?: string;
    }
  | {
      action: 'open-folder';
      /** 宿主 3D 资产（回退） */
      assetId: string;
      /** 正式贴图资产；优先打开其伴侣目录 */
      textureAssetId?: string;
      /** 旧数据仅有预览图时：打开前先升格并落盘 */
      dataUrl?: string;
      fileName?: string;
      materialId?: string;
      slot?: WorkflowModelPbrSlot;
    };

export function dispatchWorkflowModelPbrTextureAction(detail: WorkflowModelPbrTextureAction): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<WorkflowModelPbrTextureAction>(WORKFLOW_MODEL_PBR_TEXTURE_ACTION_EVENT, { detail })
  );
}

/**
 * 下载贴图原图：必须先拿到 Blob 再触发保存。
 * 跨域 https（如 file.302.ai）上直接 `<a download href>` 会被浏览器忽略，表现为打开网页预览。
 */
export async function downloadPbrTextureDataUrl(
  dataUrl: string,
  fileName?: string
): Promise<boolean> {
  const href = String(dataUrl || '').trim();
  if (!href) return false;

  const [{ parseDataUrlToBlob, imageSrcToDataUrlForCompanion }, { fetchMediaUrlViaAuthApi }, { downloadBlobPreferWorkbench, showDownloadNotice }, { ensureDownloadFilenameExtension }] =
    await Promise.all([
      import('./workflowCompanionAssets'),
      import('./mediaUrlAuthFetch'),
      import('./workbenchDownloadBridge'),
      import('./downloadFilename'),
    ]);

  let blob: Blob | null = null;
  const parsed = parseDataUrlToBlob(href);
  if (parsed) {
    blob = parsed.blob;
  } else if (/^blob:/i.test(href)) {
    try {
      blob = await (await fetch(href)).blob();
    } catch {
      blob = null;
    }
  } else {
    const asDataUrl = await imageSrcToDataUrlForCompanion(href);
    const fromData = asDataUrl ? parseDataUrlToBlob(asDataUrl) : null;
    if (fromData) blob = fromData.blob;
    if (!blob && /^https?:\/\//i.test(href)) {
      try {
        blob = await fetchMediaUrlViaAuthApi(href);
      } catch {
        blob = null;
      }
    }
  }

  if (!blob) {
    showDownloadNotice('warn', '下载失败', '无法获取贴图原图');
    return false;
  }

  const nameHint = String(fileName || 'texture.png').trim() || 'texture.png';
  const filename = await ensureDownloadFilenameExtension(nameHint, { blob });
  return downloadBlobPreferWorkbench(blob, filename, { noticeTitle: '图片已保存' });
}
