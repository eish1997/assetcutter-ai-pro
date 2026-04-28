/**
 * seam_repair：转发至本机 WebSeamRepair FastAPI（默认 http://127.0.0.1:8008/api/repair）。
 * 输入资产须已通过 PUT 落在当前 projectId 的 Volume 中。
 */

import { putAsset, readAssetObjectBytes } from '../storage/assetBlob.js';

export const SEAM_ADAPTER_ID = 'seam_repair@v0.1.0';

const DEFAULT_REPAIR_URL = 'http://127.0.0.1:8008/api/repair';

function repairUrl(): string {
  return process.env.COMPANION_SEAM_REPAIR_URL?.trim() || DEFAULT_REPAIR_URL;
}

function repairTimeoutMs(): number {
  const raw = process.env.COMPANION_SEAM_REPAIR_TIMEOUT_MS?.trim();
  const n = raw ? Number.parseInt(raw, 10) : 120_000;
  return Number.isFinite(n) && n >= 5000 && n <= 600_000 ? n : 120_000;
}

export type SeamRepairResolvedInput = {
  objKey: string;
  textureKey: string;
  maskKey?: string;
  outputKey?: string;
};

function pickRole(inputs: unknown[], role: string): string | undefined {
  for (const item of inputs) {
    if (!item || typeof item !== 'object') continue;
    const r = (item as { role?: string }).role;
    const asset = (item as { asset?: { key?: string } }).asset;
    if (r === role && asset && typeof asset.key === 'string') return asset.key;
  }
  return undefined;
}

export function resolveSeamRepairKeys(
  projectId: string | undefined,
  inputs: unknown,
): { ok: SeamRepairResolvedInput } | { error: string; code: string } {
  if (!projectId?.trim()) {
    return { error: 'seam_repair requires projectId', code: 'COMPUTE_BAD_JOB' };
  }
  if (inputs && typeof inputs === 'object' && !Array.isArray(inputs)) {
    const o = inputs as Record<string, unknown>;
    const objKey = typeof o.objKey === 'string' ? o.objKey : '';
    const textureKey = typeof o.textureKey === 'string' ? o.textureKey : '';
    const maskKey = typeof o.maskKey === 'string' && o.maskKey ? o.maskKey : undefined;
    const outputKey = typeof o.outputKey === 'string' && o.outputKey ? o.outputKey : undefined;
    if (objKey && textureKey) {
      return { ok: { objKey, textureKey, maskKey, outputKey } };
    }
  }
  if (Array.isArray(inputs)) {
    const mesh = pickRole(inputs, 'mesh');
    const tex = pickRole(inputs, 'texture') ?? pickRole(inputs, 'basecolor');
    const mask = pickRole(inputs, 'mask');
    if (mesh && tex) {
      return { ok: { objKey: mesh, textureKey: tex, maskKey: mask, outputKey: undefined } };
    }
  }
  return {
    error:
      'seam_repair: set inputs to { objKey, textureKey, maskKey?, outputKey? } or asset[] with roles mesh + texture',
    code: 'COMPUTE_BAD_JOB',
  };
}

function appendRepairFormFields(form: FormData, params: unknown): void {
  const p =
    params && typeof params === 'object' && params !== null
      ? (params as Record<string, unknown>)
      : {};

  const str = (k: string, def: string) => {
    const v = p[k];
    return typeof v === 'string' && v ? v : def;
  };
  const num = (k: string, def: number) => {
    const v = p[k];
    return typeof v === 'number' && Number.isFinite(v) ? v : def;
  };
  const bool = (k: string, def: boolean) => {
    const v = p[k];
    if (typeof v === 'boolean') return v;
    if (v === 'false' || v === '0') return false;
    if (v === 'true' || v === '1') return true;
    return def;
  };

  form.append('texture_kind', str('texture_kind', 'basecolor'));
  form.append('band_px', String(Math.round(num('band_px', 8))));
  form.append('feather_px', String(Math.round(num('feather_px', 6))));
  form.append('sample_step_px', String(num('sample_step_px', 2)));
  form.append('mode', str('mode', 'average'));
  form.append('only_masked_seams', bool('only_masked_seams', true) ? 'true' : 'false');
  form.append('alpha_method', str('alpha_method', 'distance'));
  form.append('alpha_edge_aware', bool('alpha_edge_aware', true) ? 'true' : 'false');
  form.append('guided_eps', String(num('guided_eps', 1e-4)));
  form.append('color_match', str('color_match', 'meanvar'));
  form.append('poisson_iters', String(Math.round(num('poisson_iters', 0))));
}

export async function runSeamRepairJob(
  projectId: string,
  resolved: SeamRepairResolvedInput,
  params: unknown,
): Promise<
  { ok: true; outputKey?: string; bytesOut: number } | { error: string; code: string; httpStatus?: number }
> {
  const obj = readAssetObjectBytes(projectId, resolved.objKey);
  if (!('ok' in obj && obj.ok)) {
    const e = obj as { error: string; code: string };
    return { error: e.error, code: e.code };
  }

  const tex = readAssetObjectBytes(projectId, resolved.textureKey);
  if (!('ok' in tex && tex.ok)) {
    const e = tex as { error: string; code: string };
    return { error: e.error, code: e.code };
  }

  let maskBuf: Buffer | null = null;
  if (resolved.maskKey) {
    const mask = readAssetObjectBytes(projectId, resolved.maskKey);
    if (!('ok' in mask && mask.ok)) {
      const e = mask as { error: string; code: string };
      return { error: e.error, code: e.code };
    }
    maskBuf = mask.body;
  }

  const form = new FormData();
  form.append('obj', new Blob([obj.body]), 'model.obj');
  form.append('texture', new Blob([tex.body]), 'texture.png');
  if (maskBuf) {
    form.append('seam_mask', new Blob([maskBuf]), 'mask.png');
  }
  appendRepairFormFields(form, params);

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), repairTimeoutMs());
  try {
    const res = await fetch(repairUrl(), { method: 'POST', body: form, signal: ctrl.signal });
    const ct = res.headers.get('content-type') ?? '';

    if (!res.ok) {
      let msg = `seam backend HTTP ${res.status}`;
      if (ct.includes('application/json')) {
        try {
          const j = (await res.json()) as { error?: string };
          if (j?.error) msg = j.error;
        } catch {
          /* ignore */
        }
      }
      return {
        error: msg,
        code: res.status === 400 ? 'COMPUTE_SEAM_INPUT' : 'COMPUTE_SEAM_BACKEND',
        httpStatus: res.status,
      };
    }

    if (!ct.includes('image/png')) {
      return { error: 'seam backend did not return image/png', code: 'COMPUTE_SEAM_BACKEND', httpStatus: res.status };
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) {
      return { error: 'empty PNG from seam backend', code: 'COMPUTE_SEAM_BACKEND' };
    }

    if (resolved.outputKey) {
      putAsset(projectId, resolved.outputKey, buf, 'image/png');
      return { ok: true, outputKey: resolved.outputKey, bytesOut: buf.length };
    }

    return { ok: true, bytesOut: buf.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === 'This operation was aborted' || msg.includes('aborted')) {
      return { error: 'seam repair timeout', code: 'COMPUTE_SEAM_TIMEOUT' };
    }
    return { error: msg, code: 'COMPUTE_SEAM_BACKEND' };
  } finally {
    clearTimeout(t);
  }
}

/** 供 capabilities 展示（无网络探测，避免拖慢 GET）。 */
export function getSeamRepairApiUrl(): string {
  return repairUrl();
}
