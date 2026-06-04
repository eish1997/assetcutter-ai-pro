/**
 * paddle_ocr：从 Volume 读图/PDF，调用本机 PaddleOCR HTTP 服务，写回 JSON（可选 Markdown）。
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { putAsset, readAssetObjectBytes } from '../storage/assetBlob.js';
import { isSafeIdPart } from '../storage/safeIds.js';
import { getPaddleOcrServiceUrl } from '../paddleOcrSupervisor.js';

export const PADDLE_OCR_ADAPTER_ID = 'paddle_ocr@v1';

export type PaddleOcrPipeline = 'pp_ocr_v5' | 'pp_structure_v3';
export type PaddleOcrReturnFormat = 'json' | 'markdown' | 'both';

export type PaddleOcrResolvedInput = {
  fileKey: string;
  outputKey: string;
  markdownOutputKey?: string;
  pipeline: PaddleOcrPipeline;
  lang: string;
  returnFormat: PaddleOcrReturnFormat;
};

const ALLOWED_PIPELINES = new Set<PaddleOcrPipeline>(['pp_ocr_v5', 'pp_structure_v3']);
const ALLOWED_RETURN_FORMATS = new Set<PaddleOcrReturnFormat>(['json', 'markdown', 'both']);

function isNonEmptyKey(s: unknown): s is string {
  return typeof s === 'string' && s.trim().length > 0;
}

function paddleOcrTimeoutMs(): number {
  const raw = process.env.COMPANION_PADDLEOCR_TIMEOUT_MS?.trim();
  const n = raw ? Number.parseInt(raw, 10) : 600_000;
  return Number.isFinite(n) && n >= 30_000 && n <= 1_800_000 ? n : 600_000;
}

function ensureLoopbackBypassProxyEnv(): void {
  const loop = '127.0.0.1,localhost,::1';
  const cur = String(process.env.NO_PROXY ?? process.env.no_proxy ?? '').trim();
  const merged = !cur ? loop : cur.includes('127.0.0.1') ? cur : `${cur},${loop}`;
  process.env.NO_PROXY = merged;
  process.env.no_proxy = merged;
}

function serviceUrl(): string {
  return getPaddleOcrServiceUrl().replace(/\/+$/, '');
}

function deriveHealthUrl(base: string): string | null {
  try {
    const u = new URL(base);
    if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost' && u.hostname !== '::1') {
      return null;
    }
    return `${u.origin}/health`;
  } catch {
    return null;
  }
}

function inputExtForBytes(buf: Buffer, fileKey: string): string {
  if (buf.length >= 4 && buf.slice(0, 4).toString('ascii') === '%PDF') return '.pdf';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg';
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return '.png';
  if (buf.length >= 12 && buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP')
    return '.webp';
  const lower = fileKey.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot >= 0) {
    const ext = lower.slice(dot);
    if (['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tif', '.tiff'].includes(ext)) return ext;
  }
  return '.bin';
}

function isPdfBytes(buf: Buffer): boolean {
  return buf.length >= 4 && buf.slice(0, 4).toString('ascii') === '%PDF';
}

export function resolvePaddleOcrKeys(
  projectId: string | undefined,
  inputs: unknown,
  params: unknown,
): { ok: PaddleOcrResolvedInput } | { error: string; code: string } {
  if (!projectId?.trim()) {
    return { error: 'paddle_ocr requires projectId', code: 'COMPUTE_BAD_JOB' };
  }
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) {
    return { error: 'paddle_ocr inputs must be object', code: 'COMPUTE_BAD_JOB' };
  }
  const ins = inputs as Record<string, unknown>;
  const fileKeyRaw = ins.fileKey ?? ins.imageKey;
  if (!isNonEmptyKey(fileKeyRaw) || !isNonEmptyKey(ins.outputKey)) {
    return {
      error: 'paddle_ocr requires inputs.fileKey (or imageKey) and inputs.outputKey',
      code: 'COMPUTE_BAD_JOB',
    };
  }
  const fileKey = fileKeyRaw.trim();
  const outputKey = ins.outputKey.trim();
  if (!isSafeIdPart(fileKey) || !isSafeIdPart(outputKey)) {
    return { error: 'paddle_ocr asset keys must be safe single-segment ids', code: 'COMPUTE_BAD_JOB' };
  }
  const p =
    params && typeof params === 'object' && !Array.isArray(params) ? (params as Record<string, unknown>) : {};
  const pipelineRaw = typeof p.pipeline === 'string' ? p.pipeline.trim() : 'pp_ocr_v5';
  if (!ALLOWED_PIPELINES.has(pipelineRaw as PaddleOcrPipeline)) {
    return { error: `paddle_ocr: unsupported pipeline "${pipelineRaw}"`, code: 'COMPUTE_BAD_JOB' };
  }
  const lang = typeof p.lang === 'string' && p.lang.trim() ? p.lang.trim() : 'ch';
  let returnFormat: PaddleOcrReturnFormat = 'json';
  if (typeof p.returnFormat === 'string' && ALLOWED_RETURN_FORMATS.has(p.returnFormat as PaddleOcrReturnFormat)) {
    returnFormat = p.returnFormat as PaddleOcrReturnFormat;
  } else if (pipelineRaw === 'pp_structure_v3') {
    returnFormat = 'both';
  }
  const markdownOutputKey = isNonEmptyKey(ins.markdownOutputKey) ? ins.markdownOutputKey.trim() : undefined;
  if (markdownOutputKey && !isSafeIdPart(markdownOutputKey)) {
    return { error: 'paddle_ocr markdownOutputKey must be a safe single-segment id', code: 'COMPUTE_BAD_JOB' };
  }
  if ((returnFormat === 'markdown' || returnFormat === 'both') && !markdownOutputKey) {
    return {
      error: 'paddle_ocr returnFormat=markdown|both requires inputs.markdownOutputKey',
      code: 'COMPUTE_BAD_JOB',
    };
  }
  return {
    ok: {
      fileKey,
      outputKey,
      markdownOutputKey,
      pipeline: pipelineRaw as PaddleOcrPipeline,
      lang,
      returnFormat,
    },
  };
}

type PaddleOcrRunResponse = {
  ok?: boolean;
  result?: unknown;
  markdown?: string;
  elapsed_ms?: number;
  error?: string;
};

function classifyPaddleOcrFailure(status: number, body: PaddleOcrRunResponse, rawText: string): { code: string; message: string } {
  const err = (body.error || rawText || '').trim();
  const lower = err.toLowerCase();
  if (status === 404 || lower.includes('connection refused') || lower.includes('fetch failed') || lower.includes('abort')) {
    return {
      code: 'COMPUTE_PADDLEOCR_BACKEND',
      message: 'PaddleOCR 服务不可用：请确认本机伴侣已拉起 OCR 服务（默认 127.0.0.1:18082）并完成 pip 安装。',
    };
  }
  if (lower.includes('modulenotfounderror') || lower.includes('no module named') || lower.includes('importerror')) {
    return {
      code: 'COMPUTE_PADDLEOCR_NOT_INSTALLED',
      message: 'PaddleOCR 未安装：请在 COMPANION_PADDLEOCR_PYTHON 对应环境中执行 pip install paddleocr paddlepaddle。',
    };
  }
  if (lower.includes('convertpirattribute2runtimeattribute') || lower.includes('onednn_instruction')) {
    return {
      code: 'COMPUTE_PADDLEOCR_ONEDNN',
      message:
        'OCR 引擎 CPU 推理异常（旧进程未更新）。请完全退出桌面伴侣后重新打开，或在托盘重启本机引擎后再试。',
    };
  }
  if (lower.includes('does not accept pdf')) {
    return { code: 'COMPUTE_PADDLEOCR_BAD_INPUT', message: 'PDF 请使用 params.pipeline=pp_structure_v3' };
  }
  return { code: 'COMPUTE_PADDLEOCR_FAILED', message: err.slice(0, 2000) || `PaddleOCR HTTP ${status}` };
}

async function callPaddleOcrService(
  inputPath: string,
  pipeline: PaddleOcrPipeline,
  lang: string,
): Promise<{ ok: true; data: PaddleOcrRunResponse } | { error: string; code: string }> {
  ensureLoopbackBypassProxyEnv();
  const url = `${serviceUrl()}/v1/run`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), paddleOcrTimeoutMs());
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input_path: inputPath, pipeline, lang }),
      signal: ctrl.signal,
    });
    const rawText = await res.text();
    let body: PaddleOcrRunResponse = {};
    try {
      body = rawText ? (JSON.parse(rawText) as PaddleOcrRunResponse) : {};
    } catch {
      body = { error: rawText.slice(0, 800) };
    }
    if (!res.ok || body.ok === false) {
      const mapped = classifyPaddleOcrFailure(res.status, body, rawText);
      return { error: mapped.message, code: mapped.code };
    }
    return { ok: true, data: body };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const mapped = classifyPaddleOcrFailure(0, {}, msg);
    return { error: mapped.message, code: mapped.code };
  } finally {
    clearTimeout(t);
  }
}

export async function runPaddleOcrJob(
  projectId: string,
  resolved: PaddleOcrResolvedInput,
): Promise<
  | {
      ok: true;
      outputKey: string;
      markdownOutputKey?: string;
      blockCount?: number;
      elapsedMs?: number;
      bytesOut: number;
      markdownBytesOut?: number;
    }
  | { error: string; code: string }
> {
  const file = readAssetObjectBytes(projectId, resolved.fileKey);
  if (!('ok' in file && file.ok)) {
    const e = file as { error: string; code: string };
    return { error: e.error, code: e.code };
  }
  if (resolved.pipeline === 'pp_ocr_v5' && isPdfBytes(file.body)) {
    return { error: 'PDF 请使用 params.pipeline=pp_structure_v3', code: 'COMPUTE_PADDLEOCR_BAD_INPUT' };
  }

  const dir = mkdtempSync(join(tmpdir(), 'ac-paddleocr-'));
  const ext = inputExtForBytes(file.body, resolved.fileKey);
  const inPath = join(dir, `input${ext}`);
  try {
    writeFileSync(inPath, file.body);
    const run = await callPaddleOcrService(inPath, resolved.pipeline, resolved.lang);
    if ('error' in run) return { error: run.error, code: run.code };

    const payload = {
      pipeline: resolved.pipeline,
      lang: resolved.lang,
      fileKey: resolved.fileKey,
      result: run.data.result ?? null,
      markdown: run.data.markdown ?? '',
      elapsedMs: run.data.elapsed_ms,
    };
    const jsonBuf = Buffer.from(JSON.stringify(payload, null, 2), 'utf8');
    putAsset(projectId, resolved.outputKey, jsonBuf, 'application/json');

    let markdownBytesOut: number | undefined;
    if (resolved.markdownOutputKey && (resolved.returnFormat === 'markdown' || resolved.returnFormat === 'both')) {
      const md = typeof run.data.markdown === 'string' ? run.data.markdown : '';
      const mdBuf = Buffer.from(md, 'utf8');
      putAsset(projectId, resolved.markdownOutputKey, mdBuf, 'text/markdown; charset=utf-8');
      markdownBytesOut = mdBuf.length;
    }

    let blockCount: number | undefined;
    if (
      resolved.pipeline === 'pp_ocr_v5' &&
      payload.result &&
      typeof payload.result === 'object' &&
      !Array.isArray(payload.result) &&
      Array.isArray((payload.result as { blocks?: unknown }).blocks)
    ) {
      blockCount = (payload.result as { blocks: unknown[] }).blocks.length;
    }

    return {
      ok: true,
      outputKey: resolved.outputKey,
      markdownOutputKey: resolved.markdownOutputKey,
      blockCount,
      elapsedMs: run.data.elapsed_ms,
      bytesOut: jsonBuf.length,
      markdownBytesOut,
    };
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

export type PaddleOcrHealthProbeResult = {
  ok: boolean;
  serviceUrl: string;
  healthUrl: string | null;
  paddleOcr?: { ok: boolean; latencyMs: number; body?: unknown; error?: string };
  error?: string;
  code?: string;
  device?: string;
};

export async function probePaddleOcrBackendHealth(): Promise<PaddleOcrHealthProbeResult> {
  ensureLoopbackBypassProxyEnv();
  const serviceUrlValue = serviceUrl();
  const healthUrl = deriveHealthUrl(serviceUrlValue);
  if (!healthUrl) {
    return {
      ok: false,
      serviceUrl: serviceUrlValue,
      healthUrl: null,
      error: 'COMPANION_PADDLEOCR_URL 必须指向本机回环地址',
      code: 'PADDLEOCR_PROBE_NOT_LOOPBACK',
    };
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  const t0 = Date.now();
  try {
    const res = await fetch(healthUrl, { signal: ctrl.signal });
    const latencyMs = Date.now() - t0;
    const raw = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      body = { raw: raw.slice(0, 800) };
    }
    if (!res.ok) {
      return {
        ok: false,
        serviceUrl: serviceUrlValue,
        healthUrl,
        paddleOcr: { ok: false, latencyMs, error: `HTTP ${res.status}`, body },
      };
    }
    return {
      ok: true,
      serviceUrl: serviceUrlValue,
      healthUrl,
      device: typeof body.device === 'string' ? body.device : undefined,
      paddleOcr: { ok: true, latencyMs, body },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      serviceUrl: serviceUrlValue,
      healthUrl,
      paddleOcr: { ok: false, latencyMs: Date.now() - t0, error: msg },
    };
  } finally {
    clearTimeout(t);
  }
}

export function getPaddleOcrApiUrl(): string {
  return serviceUrl();
}
