/**
 * 本机伴侣 PaddleOCR：图片认字（pp_ocr_v5）与 PDF/文档解析（pp_structure_v3）。
 */

import {
  submitCompanionPaddleOcrJob,
  type CompanionPaddleOcrParamsV1,
  type CompanionPaddleOcrPipeline,
} from './companionClient/compute';
import { fetchCompanionAssetBlob, putCompanionAsset } from './companionClient/storage';
import { companionOcrAssetKey, isCompanionSafeAssetKey } from './companionOcrKeys';
import { getCompanionLocalBaseUrl, normalizeCompanionBaseUrl } from './companionLocalPrefs';

export type CompanionOcrBlockV1 = {
  text: string;
  box?: unknown;
  score?: number | null;
};

export type CompanionOcrJsonResultV1 = {
  pipeline: CompanionPaddleOcrPipeline;
  lang: string;
  fileKey: string;
  result: { blocks?: CompanionOcrBlockV1[]; rec_texts?: string[]; texts?: string[] } | unknown;
  markdown?: string;
  elapsedMs?: number;
};

/** 从伴侣写回的 OCR JSON 提取文本块（兼容 blocks / PaddleOCR 3.x rec_texts） */
export function extractCompanionOcrBlocks(raw: CompanionOcrJsonResultV1): CompanionOcrBlockV1[] {
  const result = raw.result;
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const obj = result as { blocks?: unknown; rec_texts?: unknown; texts?: unknown };
    if (Array.isArray(obj.blocks)) {
      return obj.blocks
        .map((b) => {
          if (!b || typeof b !== 'object') return null;
          const text = String((b as { text?: unknown }).text ?? '').trim();
          if (!text) return null;
          return {
            text,
            box: (b as { box?: unknown }).box,
            score: (b as { score?: number | null }).score ?? null,
          } satisfies CompanionOcrBlockV1;
        })
        .filter((b): b is CompanionOcrBlockV1 => b !== null);
    }
    const texts = Array.isArray(obj.rec_texts)
      ? obj.rec_texts
      : Array.isArray(obj.texts)
        ? obj.texts
        : [];
    return texts
      .map((t) => String(t ?? '').trim())
      .filter(Boolean)
      .map((text) => ({ text }));
  }
  if (Array.isArray(result)) {
    const blocks: CompanionOcrBlockV1[] = [];
    for (const item of result) {
      if (!item || typeof item !== 'object') continue;
      const row = item as { rec_texts?: unknown; texts?: unknown; text?: unknown };
      const nested = Array.isArray(row.rec_texts)
        ? row.rec_texts
        : Array.isArray(row.texts)
          ? row.texts
          : null;
      if (nested) {
        for (const t of nested) {
          const text = String(t ?? '').trim();
          if (text) blocks.push({ text });
        }
        continue;
      }
      const text = String(row.text ?? '').trim();
      if (text) blocks.push({ text });
    }
    return blocks;
  }
  return [];
}

function decodeUtf8(buf: ArrayBuffer): string {
  return new TextDecoder('utf-8').decode(buf);
}

function guessMimeFromName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'application/octet-stream';
}

export async function runCompanionImageOcr(opts: {
  projectId: string;
  fileBlob: Blob;
  fileName?: string;
  fileKey?: string;
  outputKey?: string;
  lang?: string;
  companionBaseUrl?: string;
}): Promise<
  | { ok: true; outputKey: string; blocks: CompanionOcrBlockV1[]; raw: CompanionOcrJsonResultV1 }
  | { ok: false; error: string; code?: string }
> {
  return runCompanionOcrJob({
    projectId: opts.projectId,
    fileBlob: opts.fileBlob,
    fileName: opts.fileName,
    fileKey: opts.fileKey,
    outputKey: opts.outputKey,
    pipeline: 'pp_ocr_v5',
    lang: opts.lang,
    companionBaseUrl: opts.companionBaseUrl,
  });
}

export async function runCompanionDocumentImport(opts: {
  projectId: string;
  fileBlob: Blob;
  fileName?: string;
  fileKey?: string;
  outputKey?: string;
  markdownOutputKey?: string;
  lang?: string;
  companionBaseUrl?: string;
}): Promise<
  | {
      ok: true;
      outputKey: string;
      markdownOutputKey: string;
      markdown: string;
      raw: CompanionOcrJsonResultV1;
    }
  | { ok: false; error: string; code?: string }
> {
  const mdKey = opts.markdownOutputKey?.trim() || companionOcrAssetKey('markdown', Date.now(), 'md');
  const res = await runCompanionOcrJob({
    projectId: opts.projectId,
    fileBlob: opts.fileBlob,
    fileName: opts.fileName,
    fileKey: opts.fileKey,
    outputKey: opts.outputKey,
    markdownOutputKey: mdKey,
    pipeline: 'pp_structure_v3',
    lang: opts.lang,
    returnFormat: 'both',
    companionBaseUrl: opts.companionBaseUrl,
  });
  if (res.ok === false) return res;
  const markdown = typeof res.raw.markdown === 'string' ? res.raw.markdown : '';
  return {
    ok: true,
    outputKey: res.outputKey,
    markdownOutputKey: mdKey,
    markdown,
    raw: res.raw,
  };
}

async function runCompanionOcrJob(opts: {
  projectId: string;
  fileBlob: Blob;
  fileName?: string;
  fileKey?: string;
  outputKey?: string;
  markdownOutputKey?: string;
  pipeline: CompanionPaddleOcrPipeline;
  lang?: string;
  returnFormat?: CompanionPaddleOcrParamsV1['returnFormat'];
  companionBaseUrl?: string;
}): Promise<
  | { ok: true; outputKey: string; blocks: CompanionOcrBlockV1[]; raw: CompanionOcrJsonResultV1 }
  | { ok: false; error: string; code?: string }
> {
  const pid = String(opts.projectId || '').trim();
  if (!pid) return { ok: false, error: '未选择工作区项目', code: 'NO_PROJECT' };

  const base = normalizeCompanionBaseUrl((opts.companionBaseUrl || getCompanionLocalBaseUrl()).trim());
  const stamp = Date.now();
  const fileKey = (opts.fileKey || companionOcrAssetKey('upload', stamp)).trim();
  const outputKey = (opts.outputKey || companionOcrAssetKey('result', stamp, 'json')).trim();
  if (!isCompanionSafeAssetKey(fileKey) || !isCompanionSafeAssetKey(outputKey)) {
    return {
      ok: false,
      error: 'OCR 资源键格式不合法（请更新到最新版本后重试）',
      code: 'INVALID_KEY',
    };
  }
  if (opts.markdownOutputKey && !isCompanionSafeAssetKey(opts.markdownOutputKey.trim())) {
    return {
      ok: false,
      error: 'OCR Markdown 资源键格式不合法（请更新到最新版本后重试）',
      code: 'INVALID_KEY',
    };
  }
  const mime = guessMimeFromName(opts.fileName || fileKey);

  const put = await putCompanionAsset(base, pid, fileKey, opts.fileBlob, mime);
  if (put.ok === false) {
    const err =
      put.error === 'invalid_key'
        ? '写入本地伴侣失败：资源键格式不合法（请更新到最新版本后重试）'
        : put.error;
    return { ok: false, error: err, code: 'COMPANION_PUT' };
  }

  const params: CompanionPaddleOcrParamsV1 = {
    pipeline: opts.pipeline,
    lang: opts.lang || 'ch',
  };
  if (opts.returnFormat) params.returnFormat = opts.returnFormat;

  const submit = await submitCompanionPaddleOcrJob(
    base,
    pid,
    {
      fileKey,
      outputKey,
      ...(opts.markdownOutputKey ? { markdownOutputKey: opts.markdownOutputKey } : {}),
    },
    params,
  );
  if (submit.ok === false) return { ok: false, error: submit.error, code: submit.code };

  const job = submit.data?.job;
  if (!job || job.status !== 'completed') {
    return {
      ok: false,
      error: job?.error?.message || (job ? `任务状态 ${job.status}` : '未返回任务结果'),
      code: job?.error?.code,
    };
  }

  const blobRes = await fetchCompanionAssetBlob(base, pid, outputKey);
  if (blobRes.ok === false) return { ok: false, error: blobRes.error, code: 'COMPANION_FETCH' };

  let raw: CompanionOcrJsonResultV1;
  try {
    raw = JSON.parse(decodeUtf8(blobRes.data)) as CompanionOcrJsonResultV1;
  } catch {
    return { ok: false, error: 'OCR 结果 JSON 解析失败', code: 'BAD_OCR_JSON' };
  }

  const blocks = extractCompanionOcrBlocks(raw);

  return { ok: true, outputKey, blocks, raw };
}
