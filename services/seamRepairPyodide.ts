/**
 * 贴图修缝 · 浏览器内运行（Pyodide + seam_repair.py），无需后端
 */
import type { SeamRepairParams, SeamRepairRequestOptions } from './seamRepairService';

let worker: Worker | null = null;

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(
    new URL('./seamRepair.worker.ts', import.meta.url),
    { type: 'module' }
  );
  return worker;
}

function resetWorker() {
  if (!worker) return;
  worker.terminate();
  worker = null;
}

function createAbortError(message: string): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = reject;
    r.readAsArrayBuffer(file);
  });
}

export function isPyodideSupported(): boolean {
  return typeof Worker !== 'undefined' && typeof ArrayBuffer !== 'undefined';
}

/**
 * 在浏览器内用 Pyodide 执行修缝，返回 PNG Blob
 */
export async function runSeamRepairPyodide(
  objFile: File,
  textureFile: File,
  seamMaskFile: File | null,
  params: SeamRepairParams,
  options?: SeamRepairRequestOptions
): Promise<Blob> {
  if (options?.signal?.aborted) throw createAbortError('修缝已取消');
  const w = getWorker();
  const id = Math.random().toString(36).slice(2, 12);
  const objBytes = await readFileAsArrayBuffer(objFile);
  const texBytes = await readFileAsArrayBuffer(textureFile);
  const maskBytes = seamMaskFile ? await readFileAsArrayBuffer(seamMaskFile) : null;
  const timeoutMs = options?.timeoutMs ?? 120_000;

  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      options?.signal?.removeEventListener('abort', onAbort);
      w.removeEventListener('message', onMsg);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      resetWorker();
      reject(error);
    };
    const onMsg = (e: MessageEvent) => {
      const msg = e.data as { id: string; ok: boolean; pngBytes?: ArrayBuffer; error?: string };
      if (msg.id !== id) return;
      if (settled) return;
      settled = true;
      cleanup();
      if (msg.ok && msg.pngBytes) {
        resolve(new Blob([msg.pngBytes], { type: 'image/png' }));
      } else {
        reject(new Error(msg.error || 'Pyodide 修缝失败'));
      }
    };
    const onAbort = () => fail(createAbortError('修缝已取消'));
    const timer = setTimeout(() => fail(new Error(`修缝超时（>${timeoutMs}ms）`)), timeoutMs);
    w.addEventListener('message', onMsg);
    options?.signal?.addEventListener('abort', onAbort, { once: true });
    w.postMessage(
      {
        id,
        objBytes,
        texBytes,
        maskBytes,
        params: {
          texture_kind: params.texture_kind,
          band_px: params.band_px,
          feather_px: params.feather_px,
          sample_step_px: params.sample_step_px,
          mode: params.mode,
          only_masked_seams: params.only_masked_seams,
          alpha_method: params.alpha_method,
          alpha_edge_aware: params.alpha_edge_aware,
          guided_eps: params.guided_eps,
          color_match: params.color_match,
          poisson_iters: params.poisson_iters,
        },
      },
      [objBytes, texBytes, ...(maskBytes ? [maskBytes] : [])]
    );
  });
}
