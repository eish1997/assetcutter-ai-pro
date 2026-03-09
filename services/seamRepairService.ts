/**
 * 贴图修缝：优先浏览器内 Pyodide（无需后端），失败时回退到后端 API
 */
import { isPyodideSupported, runSeamRepairPyodide } from './seamRepairPyodide';

const BASE =
  (typeof import.meta !== 'undefined' && (import.meta as { env?: Record<string, string> }).env?.VITE_SEAM_REPAIR_API as string)?.trim?.() ||
  '/seam-repair-api';

export interface SeamRepairParams {
  texture_kind: string;
  band_px: number;
  feather_px: number;
  sample_step_px: number;
  mode: string;
  only_masked_seams: boolean;
  alpha_method: string;
  alpha_edge_aware: boolean;
  guided_eps: number;
  color_match: string;
  poisson_iters: number;
}

export interface SeamRepairRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export const SEAM_REPAIR_REQUEST_TIMEOUT_MS = Number(process.env.SEAM_REPAIR_REQUEST_TIMEOUT_MS) || 120_000;
const VALID_TEXTURE_KINDS = new Set(['basecolor', 'data', 'normal']);
const VALID_MODES = new Set(['average', 'a_to_b', 'b_to_a']);
const VALID_ALPHA_METHODS = new Set(['distance', 'wacc']);
const VALID_COLOR_MATCH = new Set(['none', 'meanvar', 'meanvar_edge']);

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.min(max, Math.max(min, next));
}

function createAbortError(message: string): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

export function normalizeSeamRepairParams(params: SeamRepairParams): SeamRepairParams {
  return {
    texture_kind: VALID_TEXTURE_KINDS.has(params.texture_kind) ? params.texture_kind : 'basecolor',
    band_px: Math.round(clampNumber(params.band_px, 1, 64, 8)),
    feather_px: Math.round(clampNumber(params.feather_px, 0, 64, 6)),
    sample_step_px: clampNumber(params.sample_step_px, 0.25, 16, 2),
    mode: VALID_MODES.has(params.mode) ? params.mode : 'average',
    only_masked_seams: params.only_masked_seams !== false,
    alpha_method: VALID_ALPHA_METHODS.has(params.alpha_method) ? params.alpha_method : 'distance',
    alpha_edge_aware: params.alpha_edge_aware !== false,
    guided_eps: clampNumber(params.guided_eps, 1e-8, 1, 1e-4),
    color_match: VALID_COLOR_MATCH.has(params.color_match) ? params.color_match : 'meanvar',
    poisson_iters: Math.round(clampNumber(params.poisson_iters, 0, 200, 0)),
  };
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit | undefined, options?: SeamRepairRequestOptions): Promise<Response> {
  const timeoutMs = options?.timeoutMs ?? SEAM_REPAIR_REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  let externalAbortHandler: (() => void) | null = null;

  if (options?.signal) {
    if (options.signal.aborted) throw createAbortError('修缝已取消');
    externalAbortHandler = () => controller.abort(createAbortError('修缝已取消'));
    options.signal.addEventListener('abort', externalAbortHandler, { once: true });
  }

  const timer = setTimeout(() => controller.abort(createAbortError(`修缝超时（>${timeoutMs}ms）`)), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (options?.signal?.aborted) throw createAbortError('修缝已取消');
    if (controller.signal.aborted) {
      const reasonMessage = controller.signal.reason instanceof Error ? controller.signal.reason.message : '';
      if (reasonMessage.includes('超时')) throw new Error(`修缝超时（>${timeoutMs}ms）`);
      throw createAbortError('修缝已取消');
    }
    throw error;
  } finally {
    clearTimeout(timer);
    if (options?.signal && externalAbortHandler) {
      options.signal.removeEventListener('abort', externalAbortHandler);
    }
  }
}

export async function seamRepairHealth(): Promise<{ ok: boolean }> {
  const res = await fetch(`${BASE}/api/health`);
  if (!res.ok) throw new Error(`Health ${res.status}`);
  return res.json();
}

export async function seamRepair(
  objFile: File,
  textureFile: File,
  seamMaskFile: File | null,
  params: SeamRepairParams,
  options?: SeamRepairRequestOptions
): Promise<Blob> {
  const safeParams = normalizeSeamRepairParams(params);
  const form = new FormData();
  form.append('obj', objFile);
  form.append('texture', textureFile);
  if (seamMaskFile) form.append('seam_mask', seamMaskFile);
  form.append('texture_kind', safeParams.texture_kind);
  form.append('band_px', String(safeParams.band_px));
  form.append('feather_px', String(safeParams.feather_px));
  form.append('sample_step_px', String(safeParams.sample_step_px));
  form.append('mode', safeParams.mode);
  form.append('only_masked_seams', safeParams.only_masked_seams ? 'true' : 'false');
  form.append('alpha_method', safeParams.alpha_method);
  form.append('alpha_edge_aware', safeParams.alpha_edge_aware ? 'true' : 'false');
  form.append('guided_eps', String(safeParams.guided_eps));
  form.append('color_match', safeParams.color_match);
  form.append('poisson_iters', String(safeParams.poisson_iters));

  const res = await fetchWithTimeout(`${BASE}/api/repair`, { method: 'POST', body: form }, options);
  if (!res.ok) {
    const j = await res.json().catch(() => null);
    throw new Error((j as { error?: string })?.error || `HTTP ${res.status}`);
  }
  return res.blob();
}

/**
 * 统一入口：优先用 Pyodide（纯前端），失败则用后端 API（若已配置）
 */
export async function seamRepairWithFallback(
  objFile: File,
  textureFile: File,
  seamMaskFile: File | null,
  params: SeamRepairParams,
  options?: SeamRepairRequestOptions
): Promise<{ blob: Blob; mode: 'pyodide' | 'api' }> {
  const safeParams = normalizeSeamRepairParams(params);
  if (isPyodideSupported()) {
    try {
      const blob = await runSeamRepairPyodide(objFile, textureFile, seamMaskFile, safeParams, options);
      return { blob, mode: 'pyodide' };
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw e;
      const apiBase = (typeof import.meta !== 'undefined' && (import.meta as { env?: Record<string, string> }).env?.VITE_SEAM_REPAIR_API as string)?.trim?.();
      if (apiBase || BASE === '/seam-repair-api') {
        const blob = await seamRepair(objFile, textureFile, seamMaskFile, safeParams, options);
        return { blob, mode: 'api' };
      }
      throw e;
    }
  }
  const blob = await seamRepair(objFile, textureFile, seamMaskFile, safeParams, options);
  return { blob, mode: 'api' };
}
