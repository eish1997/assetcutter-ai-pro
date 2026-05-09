/**
 * sam_segment：从 Volume 读图与 prompt，调用本机 SamLocal HTTP，写回 mask PNG。
 * 契约见 docs/本地伴侣SAM分割-产品开发规格.md
 */

import { putAsset, readAssetObjectBytes } from '../storage/assetBlob.js';

export const SAM_SEGMENT_ADAPTER_ID = 'sam_segment@v1';

const DEFAULT_SEGMENT_URL = 'http://127.0.0.1:18081/v1/segment/predict';

export type SamSegmentPromptPointV1 = { x: number; y: number; label: number };

export type SamSegmentPromptBoxV1 = { x1: number; y1: number; x2: number; y2: number };

/** 与规格 SamSegmentPromptV1 一致 */
export type SamSegmentPromptV1 = {
  coordSpace: 'pixel';
  width: number;
  height: number;
  /** 全图自动拆分（Automatic Mask Generator），无 points/box */
  autoSegment?: boolean;
  points?: SamSegmentPromptPointV1[];
  box?: SamSegmentPromptBoxV1 | null;
  multimaskOutput?: boolean;
  /** true 时 SamLocal 返回 application/json（多枚 mask），伴侣写入主键 + _m1/_m2… */
  returnAllMasks?: boolean;
};

export type SamSegmentResolvedInput = {
  imageKey: string;
  outputKey: string;
  prompt: SamSegmentPromptV1;
};

function segmentUrl(): string {
  return process.env.COMPANION_SAM_SEGMENT_URL?.trim() || DEFAULT_SEGMENT_URL;
}

/** 系统/公司代理若未排除回环，Node fetch 访问 SamLocal 会失败（日志多为 COMPUTE_SAM_BACKEND）。 */
function ensureSamLocalBypassProxyEnv(): void {
  const loop = '127.0.0.1,localhost,::1';
  const cur = String(process.env.NO_PROXY ?? process.env.no_proxy ?? '').trim();
  const merged = !cur ? loop : cur.includes('127.0.0.1') ? cur : `${cur},${loop}`;
  process.env.NO_PROXY = merged;
  process.env.no_proxy = merged;
}

function segmentTimeoutMs(): number {
  const raw = process.env.COMPANION_SAM_SEGMENT_TIMEOUT_MS?.trim();
  const n = raw ? Number.parseInt(raw, 10) : 120_000;
  return Number.isFinite(n) && n >= 5000 && n <= 600_000 ? n : 120_000;
}

function isNonEmptyKey(s: unknown): s is string {
  return typeof s === 'string' && s.trim().length > 0;
}

export function parseSamSegmentPromptV1(raw: unknown): { ok: SamSegmentPromptV1 } | { error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'prompt must be object' };
  }
  const o = raw as Record<string, unknown>;
  if (o.coordSpace !== 'pixel') {
    return { error: 'coordSpace must be pixel' };
  }
  const width = Number(o.width);
  const height = Number(o.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    return { error: 'invalid width/height' };
  }
  const points = Array.isArray(o.points)
    ? o.points.map((p) => {
        if (!p || typeof p !== 'object') return null;
        const q = p as Record<string, unknown>;
        const x = Number(q.x);
        const y = Number(q.y);
        const label = Number(q.label ?? 1);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(label)) return null;
        return { x, y, label };
      })
    : undefined;
  if (points?.some((p) => p == null)) {
    return { error: 'invalid points' };
  }
  let box: SamSegmentPromptBoxV1 | null | undefined;
  if (o.box === null || o.box === undefined) {
    box = o.box === null ? null : undefined;
  } else if (o.box && typeof o.box === 'object' && !Array.isArray(o.box)) {
    const b = o.box as Record<string, unknown>;
    const x1 = Number(b.x1);
    const y1 = Number(b.y1);
    const x2 = Number(b.x2);
    const y2 = Number(b.y2);
    if (![x1, y1, x2, y2].every((n) => Number.isFinite(n))) {
      return { error: 'invalid box' };
    }
    box = { x1, y1, x2, y2 };
  } else {
    return { error: 'invalid box' };
  }
  const autoSegment = typeof o.autoSegment === 'boolean' ? o.autoSegment : false;
  const returnAllMasks = typeof o.returnAllMasks === 'boolean' ? o.returnAllMasks : false;
  const multimaskOutputRaw = typeof o.multimaskOutput === 'boolean' ? o.multimaskOutput : false;
  const multimaskOutput = returnAllMasks || autoSegment ? true : multimaskOutputRaw;
  return {
    ok: {
      coordSpace: 'pixel',
      width: Math.round(width),
      height: Math.round(height),
      ...(points ? { points: points as SamSegmentPromptPointV1[] } : {}),
      ...(box !== undefined ? { box } : {}),
      multimaskOutput,
      ...(returnAllMasks || autoSegment ? { returnAllMasks: true } : {}),
      ...(autoSegment ? { autoSegment: true } : {}),
    },
  };
}

function companionSamAltOutputKey(primaryKey: string, idx: number): string {
  const suffix = `_m${idx}`;
  if (primaryKey.length + suffix.length <= 128) return primaryKey + suffix;
  return primaryKey.slice(0, 128 - suffix.length) + suffix;
}

/**
 * 解析 Job inputs + params.prompt（权威来源为 params.prompt）。
 */
export function resolveSamSegmentKeys(
  projectId: string | undefined,
  inputs: unknown,
  params: unknown,
): { ok: SamSegmentResolvedInput } | { error: string; code: string } {
  if (!projectId?.trim()) {
    return { error: 'sam_segment requires projectId', code: 'COMPUTE_BAD_JOB' };
  }
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) {
    return { error: 'sam_segment inputs must be object', code: 'COMPUTE_BAD_JOB' };
  }
  const ins = inputs as Record<string, unknown>;
  if (!isNonEmptyKey(ins.imageKey) || !isNonEmptyKey(ins.outputKey)) {
    return { error: 'sam_segment requires inputs.imageKey and inputs.outputKey', code: 'COMPUTE_BAD_JOB' };
  }
  const pRaw =
    params && typeof params === 'object' && !Array.isArray(params)
      ? (params as Record<string, unknown>).prompt
      : undefined;
  const parsed = parseSamSegmentPromptV1(pRaw);
  if ('error' in parsed) {
    return { error: `params.prompt: ${parsed.error}`, code: 'COMPUTE_BAD_JOB' };
  }
  return {
    ok: {
      imageKey: ins.imageKey.trim(),
      outputKey: ins.outputKey.trim(),
      prompt: parsed.ok,
    },
  };
}

function mapBackendError(status: number, detailText: string): { code: string; message: string } {
  if (status === 413) {
    return { code: 'COMPUTE_SAM_INPUT_TOO_LARGE', message: detailText || 'image too large' };
  }
  if (status === 503) {
    return { code: 'COMPUTE_SAM_MODEL_MISSING', message: detailText || 'model not available' };
  }
  if (status === 400) {
    if (detailText.includes('!=') || detailText.toLowerCase().includes('prompt size')) {
      return { code: 'COMPUTE_SAM_PROMPT_MISMATCH', message: detailText };
    }
    return { code: 'COMPUTE_BAD_JOB', message: detailText || 'bad request' };
  }
  return { code: 'COMPUTE_SAM_BACKEND', message: detailText || `HTTP ${status}` };
}

export async function runSamSegmentJob(
  projectId: string,
  resolved: SamSegmentResolvedInput,
): Promise<
  | { ok: true; outputKey: string; bytesOut: number; samMultimaskKeys?: string[] }
  | { error: string; code: string; httpStatus?: number }
> {
  const img = readAssetObjectBytes(projectId, resolved.imageKey);
  if (!('ok' in img && img.ok)) {
    const e = img as { error: string; code: string };
    return { error: e.error, code: e.code };
  }

  ensureSamLocalBypassProxyEnv();

  const form = new FormData();
  form.append('image', new Blob([img.body]), 'image.png');
  form.append('prompt', JSON.stringify(resolved.prompt));

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), segmentTimeoutMs());
  try {
    const res = await fetch(segmentUrl(), { method: 'POST', body: form, signal: ctrl.signal });
    const ct = res.headers.get('content-type') ?? '';

    if (!res.ok) {
      let detail = `sam backend HTTP ${res.status}`;
      const raw = await res.text().catch(() => '');
      if (raw) {
        try {
          const j = JSON.parse(raw) as { detail?: unknown };
          if (typeof j?.detail === 'string') detail = j.detail;
          else if (Array.isArray(j.detail)) detail = JSON.stringify(j.detail);
          else detail = raw.slice(0, 500);
        } catch {
          detail = raw.slice(0, 500);
        }
      }
      const mapped = mapBackendError(res.status, detail);
      return { error: mapped.message, code: mapped.code, httpStatus: res.status };
    }

    // SamLocal 自 v0.2.1 起 predict 恒为 application/json + masks[]；不再依赖 returnAllMasks 才解析。
    if (ct.includes('application/json')) {
      const rawText = await res.text();
      let parsed: { masks?: Array<{ score?: number; pngBase64?: string }> };
      try {
        parsed = JSON.parse(rawText) as { masks?: Array<{ score?: number; pngBase64?: string }> };
      } catch {
        return { error: 'sam backend returned invalid json', code: 'COMPUTE_SAM_OUTPUT', httpStatus: res.status };
      }
      const masks = Array.isArray(parsed.masks) ? parsed.masks : [];
      if (masks.length === 0) {
        return { error: 'sam json had no masks', code: 'COMPUTE_SAM_OUTPUT', httpStatus: res.status };
      }
      const keys: string[] = [];
      let bytes0 = 0;
      for (let i = 0; i < masks.length; i += 1) {
        const b64 = masks[i]?.pngBase64;
        if (typeof b64 !== 'string' || !b64) {
          return { error: 'sam mask missing pngBase64', code: 'COMPUTE_SAM_OUTPUT', httpStatus: res.status };
        }
        const buf = Buffer.from(b64, 'base64');
        if (buf.length === 0) {
          return { error: 'empty mask in sam json', code: 'COMPUTE_SAM_OUTPUT', httpStatus: res.status };
        }
        const key = i === 0 ? resolved.outputKey : companionSamAltOutputKey(resolved.outputKey, i);
        putAsset(projectId, key, buf, 'image/png');
        keys.push(key);
        if (i === 0) bytes0 = buf.length;
      }
      return { ok: true, outputKey: resolved.outputKey, bytesOut: bytes0, samMultimaskKeys: keys };
    }

    return {
      error:
        'sam backend did not return application/json (upgrade SamLocal: predict always returns { masks: [...] })',
      code: 'COMPUTE_SAM_OUTPUT',
      httpStatus: res.status,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === 'This operation was aborted' || msg.includes('aborted')) {
      return { error: 'sam segment timeout', code: 'COMPUTE_SAM_TIMEOUT' };
    }
    return { error: msg, code: 'COMPUTE_SAM_BACKEND' };
  } finally {
    clearTimeout(t);
  }
}

function isLoopbackHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === '127.0.0.1' || h === 'localhost' || h === '::1';
}

/**
 * 从 predict URL 推导 `GET /health`；仅允许回环主机（规格 §7 防 SSRF）。
 */
export function deriveSamSegmentHealthUrl(predictUrl: string): string | null {
  try {
    const u = new URL(predictUrl);
    if (!isLoopbackHostname(u.hostname)) return null;
    return `${u.origin}/health`;
  } catch {
    return null;
  }
}

export type SamSegmentHealthProbeResult = {
  ok: boolean;
  predictEndpoint: string;
  healthUrl: string | null;
  samLocal?: { ok: boolean; latencyMs: number; body?: unknown; error?: string };
  error?: string;
  code?: string;
};

/** 由伴侣代探测 SamLocal（浏览器直连易受 CORS 限制） */
export async function probeSamSegmentBackendHealth(): Promise<SamSegmentHealthProbeResult> {
  ensureSamLocalBypassProxyEnv();
  const predictEndpoint = segmentUrl();
  const healthUrl = deriveSamSegmentHealthUrl(predictEndpoint);
  if (!healthUrl) {
    return {
      ok: false,
      predictEndpoint,
      healthUrl: null,
      error: 'COMPANION_SAM_SEGMENT_URL 必须指向本机回环地址（127.0.0.1 / localhost / ::1）',
      code: 'SAM_PROBE_NOT_LOOPBACK',
    };
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  const t0 = Date.now();
  try {
    const res = await fetch(healthUrl, { signal: ctrl.signal });
    const latencyMs = Date.now() - t0;
    const raw = await res.text();
    let body: unknown = raw;
    try {
      body = raw ? (JSON.parse(raw) as unknown) : {};
    } catch {
      body = { raw: raw.slice(0, 800) };
    }
    if (!res.ok) {
      return {
        ok: false,
        predictEndpoint,
        healthUrl,
        samLocal: { ok: false, latencyMs, error: `HTTP ${res.status}`, body },
      };
    }
    return {
      ok: true,
      predictEndpoint,
      healthUrl,
      samLocal: { ok: true, latencyMs, body },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      predictEndpoint,
      healthUrl,
      samLocal: { ok: false, latencyMs: Date.now() - t0, error: msg },
    };
  } finally {
    clearTimeout(t);
  }
}

/** 供管理页展示（无网络探测） */
export function getSamSegmentApiUrl(): string {
  return segmentUrl();
}
