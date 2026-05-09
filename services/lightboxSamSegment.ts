/**
 * 大图预览：本机伴侣 sam_segment（点/框提示 → Volume PUT → Job → 拉取 mask，支持 multimask）
 */

import { submitCompanionSamSegmentJob } from './companionClient/compute';
import { fetchCompanionAssetBlob } from './companionClient/storage';
import { getCompanionLocalBaseUrl } from './companionLocalPrefs';
import { normalizeCompanionBaseUrl } from './companionLocalPrefs';
import {
  imageSrcToDataUrlForCompanion,
  putWorkflowOriginalImageToCompanion,
  putWorkflowResultImageToCompanion,
  workflowResultCompanionStorageKey,
} from './workflowCompanionAssets';

export type LightboxSamSegmentPick = { ix: number; iy: number; nw: number; nh: number };

/** 与 `ImageFlatAnnotationOverlay` 同源的提示（像素索引相对当前 metrics.nw/nh） */
export type LightboxSamSegmentSession = {
  nw: number;
  nh: number;
  points: Array<{ ix: number; iy: number; label: 0 | 1 }>;
  box?: { x1: number; y1: number; x2: number; y2: number } | null;
};

export type LightboxSamSegmentMultimask = {
  dataUrls: string[];
  companionKeys: string[];
};

/** 从 data URL 读 naturalWidth/Height（浏览器环境） */
export function naturalSizeFromImageDataUrl(dataUrl: string): Promise<{ w: number; h: number } | null> {
  const s = String(dataUrl || '').trim();
  if (!s) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || 0;
      const h = img.naturalHeight || 0;
      resolve(w > 0 && h > 0 ? { w, h } : null);
    };
    img.onerror = () => resolve(null);
    img.src = s;
  });
}

function arrayBufferToDataUrl(buf: ArrayBuffer, mime: string): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(bin)}`;
}

function scaleIxIyToNat(
  ix: number,
  iy: number,
  pickNw: number,
  pickNh: number,
  pw: number,
  ph: number
): { x: number; y: number } {
  let x = ix;
  let y = iy;
  if (pickNw > 0 && pickNh > 0 && (pickNw !== pw || pickNh !== ph)) {
    x = Math.round((ix + 0.5) * (pw / pickNw) - 0.5);
    y = Math.round((iy + 0.5) * (ph / pickNh) - 0.5);
  }
  x = Math.min(pw - 1, Math.max(0, x));
  y = Math.min(ph - 1, Math.max(0, y));
  return { x, y };
}

function scaleBoxToNat(
  box: { x1: number; y1: number; x2: number; y2: number },
  pickNw: number,
  pickNh: number,
  pw: number,
  ph: number
): { x1: number; y1: number; x2: number; y2: number } {
  const a = scaleIxIyToNat(box.x1, box.y1, pickNw, pickNh, pw, ph);
  const b = scaleIxIyToNat(box.x2, box.y2, pickNw, pickNh, pw, ph);
  let x1 = Math.min(a.x, b.x);
  let y1 = Math.min(a.y, b.y);
  let x2 = Math.max(a.x, b.x);
  let y2 = Math.max(a.y, b.y);
  x1 = Math.min(pw - 1, Math.max(0, x1));
  y1 = Math.min(ph - 1, Math.max(0, y1));
  x2 = Math.min(pw - 1, Math.max(0, x2));
  y2 = Math.min(ph - 1, Math.max(0, y2));
  if (x2 < x1) [x1, x2] = [x2, x1];
  if (y2 < y1) [y1, y2] = [y2, y1];
  return { x1, y1, x2, y2 };
}

/**
 * 已有 data URL 时：PUT → sam_segment → 拉 mask（工作流 `executeCapability` 与大图共用）。
 * @param session 若省略则使用单点前景点（兼容旧 `pick`）。
 */
export async function runSamSegmentFromDataUrl(opts: {
  projectId: string;
  assetId: string;
  displayKey: string;
  dataUrl: string;
  resultKey: string;
  /** @deprecated 请用 session；仍支持单点快捷 */
  pick?: LightboxSamSegmentPick;
  session?: LightboxSamSegmentSession;
}): Promise<
  | {
      ok: true;
      resultDataUrl: string;
      outputCompanionKey: string;
      imageCompanionKey: string;
      multimask?: LightboxSamSegmentMultimask;
    }
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

  const nat = await naturalSizeFromImageDataUrl(dataUrl);
  if (!nat) {
    return { ok: false, error: '无法读取图像尺寸', code: 'BAD_SRC' };
  }
  const pw = nat.w;
  const ph = nat.h;

  let session: LightboxSamSegmentSession;
  const boxOk =
    opts.session?.box != null &&
    Math.abs(opts.session.box.x2 - opts.session.box.x1) >= 1 &&
    Math.abs(opts.session.box.y2 - opts.session.box.y1) >= 1;
  if (opts.session && (opts.session.points.length > 0 || boxOk)) {
    session = opts.session;
  } else if (opts.pick) {
    const p = opts.pick;
    session = {
      nw: p.nw,
      nh: p.nh,
      points: [{ ix: p.ix, iy: p.iy, label: 1 }],
      box: null,
    };
  } else {
    return { ok: false, error: '未提供分割提示（点或框）', code: 'BAD_PROMPT' };
  }

  const pickNw = session.nw;
  const pickNh = session.nh;

  const pointsPx = session.points.map((pt) => {
    const { x, y } = scaleIxIyToNat(pt.ix, pt.iy, pickNw, pickNh, pw, ph);
    return { x, y, label: pt.label };
  });

  let boxPx: { x1: number; y1: number; x2: number; y2: number } | undefined;
  if (session.box) {
    boxPx = scaleBoxToNat(session.box, pickNw, pickNh, pw, ph);
    if (boxPx.x2 - boxPx.x1 < 2 || boxPx.y2 - boxPx.y1 < 2) {
      boxPx = undefined;
    }
  }

  if (pointsPx.length === 0 && !boxPx) {
    return { ok: false, error: '请至少添加一个前景点或框选区域', code: 'BAD_PROMPT' };
  }

  const outputKey = workflowResultCompanionStorageKey(opts.assetId, opts.resultKey);
  const prompt: Parameters<typeof submitCompanionSamSegmentJob>[3]['prompt'] = {
    coordSpace: 'pixel',
    width: pw,
    height: ph,
    ...(pointsPx.length ? { points: pointsPx } : {}),
    ...(boxPx ? { box: boxPx } : {}),
    multimaskOutput: true,
    returnAllMasks: true,
  };

  const submit = await submitCompanionSamSegmentJob(
    base,
    pid,
    { imageKey: put.key, outputKey },
    { prompt }
  );

  if (submit.ok === false) {
    return { ok: false, error: submit.error, code: submit.code };
  }

  const job = submit.data?.job;
  if (!job || job.status !== 'completed') {
    const code = job?.error?.code;
    const msg = job?.error?.message || (job ? `任务状态 ${job.status}` : '未返回任务结果');
    return { ok: false, error: msg, code };
  }

  const mmKeys = job.result?.samMultimaskKeys;
  const keysToFetch = mmKeys && mmKeys.length > 0 ? mmKeys : [outputKey];

  const blobs = await Promise.all(
    keysToFetch.map(async (key) => {
      const blobRes = await fetchCompanionAssetBlob(base, pid, key);
      if (blobRes.ok === false) {
        return { ok: false as const, error: blobRes.error };
      }
      return { ok: true as const, data: blobRes.data };
    })
  );
  const firstBad = blobs.find((b) => !b.ok);
  if (firstBad && !('data' in firstBad)) {
    return { ok: false, error: (firstBad as { ok: false; error: string }).error, code: 'COMPANION_FETCH' };
  }

  const dataUrls = blobs.map((b) => arrayBufferToDataUrl((b as { ok: true; data: ArrayBuffer }).data, 'image/png'));
  const resultDataUrl = dataUrls[0]!;
  const multimask: LightboxSamSegmentMultimask | undefined =
    dataUrls.length > 1 ? { dataUrls, companionKeys: keysToFetch } : undefined;

  return {
    ok: true,
    resultDataUrl,
    outputCompanionKey: keysToFetch[0]!,
    imageCompanionKey: put.key,
    ...(multimask ? { multimask } : {}),
  };
}

/**
 * 将当前大图源写入伴侣并提交 sam_segment，返回 mask 的 data URL 与结果槽位 key（未写入 WorkflowAsset）。
 */
export async function runLightboxSamSegmentFromPick(opts: {
  projectId: string;
  assetId: string;
  displayKey: string;
  imageSrc: string;
  pick: LightboxSamSegmentPick;
  resultKey: string;
}): Promise<
  | {
      ok: true;
      resultDataUrl: string;
      outputCompanionKey: string;
      imageCompanionKey: string;
      multimask?: LightboxSamSegmentMultimask;
    }
  | { ok: false; error: string; code?: string }
> {
  const dataUrl = await imageSrcToDataUrlForCompanion(opts.imageSrc);
  if (!dataUrl) {
    return { ok: false, error: '无法读取当前图像（请检查图片来源或跨域）', code: 'BAD_SRC' };
  }
  return runSamSegmentFromDataUrl({
    projectId: opts.projectId,
    assetId: opts.assetId,
    displayKey: opts.displayKey,
    dataUrl,
    resultKey: opts.resultKey,
    pick: opts.pick,
  });
}

/** 大图：完整会话（多点 + 可选框） */
export async function runLightboxSamSegmentFromSession(opts: {
  projectId: string;
  assetId: string;
  displayKey: string;
  imageSrc: string;
  session: LightboxSamSegmentSession;
  resultKey: string;
}): Promise<
  | {
      ok: true;
      resultDataUrl: string;
      outputCompanionKey: string;
      imageCompanionKey: string;
      multimask?: LightboxSamSegmentMultimask;
    }
  | { ok: false; error: string; code?: string }
> {
  const dataUrl = await imageSrcToDataUrlForCompanion(opts.imageSrc);
  if (!dataUrl) {
    return { ok: false, error: '无法读取当前图像（请检查图片来源或跨域）', code: 'BAD_SRC' };
  }
  return runSamSegmentFromDataUrl({
    projectId: opts.projectId,
    assetId: opts.assetId,
    displayKey: opts.displayKey,
    dataUrl,
    resultKey: opts.resultKey,
    session: opts.session,
  });
}

/** 全图自动拆分（SamLocal `autoSegment` + Automatic Mask Generator） */
export async function runSamAutoSegmentFromDataUrl(opts: {
  projectId: string;
  assetId: string;
  displayKey: string;
  dataUrl: string;
  resultKey: string;
}): Promise<
  | {
      ok: true;
      resultDataUrl: string;
      outputCompanionKey: string;
      imageCompanionKey: string;
      multimask: LightboxSamSegmentMultimask;
    }
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

  const nat = await naturalSizeFromImageDataUrl(dataUrl);
  if (!nat) {
    return { ok: false, error: '无法读取图像尺寸', code: 'BAD_SRC' };
  }
  const pw = nat.w;
  const ph = nat.h;

  const outputKey = workflowResultCompanionStorageKey(opts.assetId, opts.resultKey);
  const prompt: Parameters<typeof submitCompanionSamSegmentJob>[3]['prompt'] = {
    coordSpace: 'pixel',
    width: pw,
    height: ph,
    autoSegment: true,
    multimaskOutput: true,
    returnAllMasks: true,
  };

  const submit = await submitCompanionSamSegmentJob(
    base,
    pid,
    { imageKey: put.key, outputKey },
    { prompt }
  );

  if (submit.ok === false) {
    return { ok: false, error: submit.error, code: submit.code };
  }

  const job = submit.data?.job;
  if (!job || job.status !== 'completed') {
    const code = job?.error?.code;
    const msg = job?.error?.message || (job ? `任务状态 ${job.status}` : '未返回任务结果');
    return { ok: false, error: msg, code };
  }

  const mmKeys = job.result?.samMultimaskKeys;
  const keysToFetch = mmKeys && mmKeys.length > 0 ? mmKeys : [outputKey];

  const blobs = await Promise.all(
    keysToFetch.map(async (key) => {
      const blobRes = await fetchCompanionAssetBlob(base, pid, key);
      if (blobRes.ok === false) {
        return { ok: false as const, error: blobRes.error };
      }
      return { ok: true as const, data: blobRes.data };
    })
  );
  const firstBad = blobs.find((b) => !b.ok);
  if (firstBad && !('data' in firstBad)) {
    return { ok: false, error: (firstBad as { ok: false; error: string }).error, code: 'COMPANION_FETCH' };
  }

  const dataUrls = blobs.map((b) => arrayBufferToDataUrl((b as { ok: true; data: ArrayBuffer }).data, 'image/png'));
  if (dataUrls.length === 0) {
    return { ok: false, error: '自动分割未返回任何 mask', code: 'BAD_OUTPUT' };
  }
  return {
    ok: true,
    resultDataUrl: dataUrls[0]!,
    outputCompanionKey: keysToFetch[0]!,
    imageCompanionKey: put.key,
    multimask: { dataUrls, companionKeys: keysToFetch },
  };
}

export async function runLightboxSamAutoSegmentFromImageSrc(opts: {
  projectId: string;
  assetId: string;
  displayKey: string;
  imageSrc: string;
  resultKey: string;
}): Promise<
  | {
      ok: true;
      resultDataUrl: string;
      outputCompanionKey: string;
      imageCompanionKey: string;
      multimask: LightboxSamSegmentMultimask;
    }
  | { ok: false; error: string; code?: string }
> {
  const dataUrl = await imageSrcToDataUrlForCompanion(opts.imageSrc);
  if (!dataUrl) {
    return { ok: false, error: '无法读取当前图像（请检查图片来源或跨域）', code: 'BAD_SRC' };
  }
  return runSamAutoSegmentFromDataUrl({
    projectId: opts.projectId,
    assetId: opts.assetId,
    displayKey: opts.displayKey,
    dataUrl,
    resultKey: opts.resultKey,
  });
}
