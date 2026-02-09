/**
 * 贴图修缝 · 浏览器内运行（Pyodide + seam_repair.py），无需后端
 */
import type { SeamRepairParams } from './seamRepairService';

let worker: Worker | null = null;

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(
    new URL('./seamRepair.worker.ts', import.meta.url),
    { type: 'module' }
  );
  return worker;
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
  params: SeamRepairParams
): Promise<Blob> {
  const w = getWorker();
  const id = Math.random().toString(36).slice(2, 12);
  const objBytes = await readFileAsArrayBuffer(objFile);
  const texBytes = await readFileAsArrayBuffer(textureFile);
  const maskBytes = seamMaskFile ? await readFileAsArrayBuffer(seamMaskFile) : null;

  return new Promise((resolve, reject) => {
    const onMsg = (e: MessageEvent) => {
      const msg = e.data as { id: string; ok: boolean; pngBytes?: ArrayBuffer; error?: string };
      if (msg.id !== id) return;
      w.removeEventListener('message', onMsg);
      if (msg.ok && msg.pngBytes) {
        resolve(new Blob([msg.pngBytes], { type: 'image/png' }));
      } else {
        reject(new Error(msg.error || 'Pyodide 修缝失败'));
      }
    };
    w.addEventListener('message', onMsg);
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
