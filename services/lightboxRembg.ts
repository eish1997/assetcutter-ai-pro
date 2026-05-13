/**
 * 大图预览：本机伴侣 remove_bg（rembg → Volume PNG → 拉取为 data URL）
 */

import { submitCompanionRembgJob } from './companionClient/compute';
import { fetchCompanionAssetBlob } from './companionClient/storage';
import { getCompanionLocalBaseUrl, normalizeCompanionBaseUrl } from './companionLocalPrefs';
import {
  imageSrcToDataUrlForCompanion,
  putWorkflowOriginalImageToCompanion,
  putWorkflowResultImageToCompanion,
  workflowResultCompanionStorageKey,
} from './workflowCompanionAssets';

function arrayBufferToDataUrl(buf: ArrayBuffer, mime: string): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(bin)}`;
}

export async function runLightboxRembgFromDataUrl(opts: {
  projectId: string;
  assetId: string;
  displayKey: string;
  dataUrl: string;
  resultKey: string;
  model?: string;
  alphaMatting?: boolean;
}): Promise<
  | { ok: true; resultDataUrl: string; outputCompanionKey: string; imageCompanionKey: string }
  | { ok: false; error: string; code?: string }
> {
  const pid = String(opts.projectId || '').trim();
  if (!pid) return { ok: false, error: '未选择工作区项目', code: 'NO_PROJECT' };

  const base = normalizeCompanionBaseUrl(getCompanionLocalBaseUrl());
  const dataUrl = String(opts.dataUrl || '').trim();
  if (!dataUrl) {
    return { ok: false, error: '无法读取当前图像（请检查图片来源或跨域）', code: 'BAD_SRC' };
  }

  const dk = String(opts.displayKey || '').trim() || 'original';
  const put =
    dk === 'original'
      ? await putWorkflowOriginalImageToCompanion(base, pid, opts.assetId, dataUrl)
      : await putWorkflowResultImageToCompanion(base, pid, opts.assetId, dk, dataUrl);
  if (put.ok === false) {
    return { ok: false, error: put.error, code: 'COMPANION_PUT' };
  }

  const outputKey = workflowResultCompanionStorageKey(opts.assetId, opts.resultKey);
  const params: { model?: string; alphaMatting?: boolean } = {};
  const m = typeof opts.model === 'string' ? opts.model.trim() : '';
  if (m) params.model = m;
  if (opts.alphaMatting === true) params.alphaMatting = true;

  const submit = await submitCompanionRembgJob(base, pid, { imageKey: put.key, outputKey }, params);

  if (submit.ok === false) {
    return { ok: false, error: submit.error, code: submit.code };
  }

  const job = submit.data?.job;
  if (!job || job.status !== 'completed') {
    const code = job?.error?.code;
    const msg = job?.error?.message || (job ? `任务状态 ${job.status}` : '未返回任务结果');
    return { ok: false, error: msg, code };
  }

  const blobRes = await fetchCompanionAssetBlob(base, pid, outputKey);
  if (blobRes.ok === false) {
    return { ok: false, error: blobRes.error, code: 'COMPANION_FETCH' };
  }

  const resultDataUrl = arrayBufferToDataUrl(blobRes.data, 'image/png');
  return {
    ok: true,
    resultDataUrl,
    outputCompanionKey: outputKey,
    imageCompanionKey: put.key,
  };
}

export async function runLightboxRembgFromImageSrc(opts: {
  projectId: string;
  assetId: string;
  displayKey: string;
  imageSrc: string;
  resultKey: string;
  model?: string;
  alphaMatting?: boolean;
}): Promise<
  | { ok: true; resultDataUrl: string; outputCompanionKey: string; imageCompanionKey: string }
  | { ok: false; error: string; code?: string }
> {
  const dataUrl = await imageSrcToDataUrlForCompanion(opts.imageSrc);
  if (!dataUrl) {
    return { ok: false, error: '无法读取当前图像（请检查图片来源或跨域）', code: 'BAD_SRC' };
  }
  return runLightboxRembgFromDataUrl({
    projectId: opts.projectId,
    assetId: opts.assetId,
    displayKey: opts.displayKey,
    dataUrl,
    resultKey: opts.resultKey,
    model: opts.model,
    alphaMatting: opts.alphaMatting,
  });
}
