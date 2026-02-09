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

export async function seamRepairHealth(): Promise<{ ok: boolean }> {
  const res = await fetch(`${BASE}/api/health`);
  if (!res.ok) throw new Error(`Health ${res.status}`);
  return res.json();
}

export async function seamRepair(
  objFile: File,
  textureFile: File,
  seamMaskFile: File | null,
  params: SeamRepairParams
): Promise<Blob> {
  const form = new FormData();
  form.append('obj', objFile);
  form.append('texture', textureFile);
  if (seamMaskFile) form.append('seam_mask', seamMaskFile);
  form.append('texture_kind', params.texture_kind);
  form.append('band_px', String(params.band_px));
  form.append('feather_px', String(params.feather_px));
  form.append('sample_step_px', String(params.sample_step_px));
  form.append('mode', params.mode);
  form.append('only_masked_seams', params.only_masked_seams ? 'true' : 'false');
  form.append('alpha_method', params.alpha_method);
  form.append('alpha_edge_aware', params.alpha_edge_aware ? 'true' : 'false');
  form.append('guided_eps', String(params.guided_eps));
  form.append('color_match', params.color_match);
  form.append('poisson_iters', String(params.poisson_iters));

  const res = await fetch(`${BASE}/api/repair`, { method: 'POST', body: form });
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
  params: SeamRepairParams
): Promise<{ blob: Blob; mode: 'pyodide' | 'api' }> {
  if (isPyodideSupported()) {
    try {
      const blob = await runSeamRepairPyodide(objFile, textureFile, seamMaskFile, params);
      return { blob, mode: 'pyodide' };
    } catch (e) {
      const apiBase = (typeof import.meta !== 'undefined' && (import.meta as { env?: Record<string, string> }).env?.VITE_SEAM_REPAIR_API as string)?.trim?.();
      if (apiBase || BASE === '/seam-repair-api') {
        const blob = await seamRepair(objFile, textureFile, seamMaskFile, params);
        return { blob, mode: 'api' };
      }
      throw e;
    }
  }
  const blob = await seamRepair(objFile, textureFile, seamMaskFile, params);
  return { blob, mode: 'api' };
}
