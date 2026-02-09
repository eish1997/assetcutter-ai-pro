/**
 * Web Worker：在浏览器内用 Pyodide 跑 seam_repair.py，无需后端
 */
const PYODIDE_INDEX = 'https://cdn.jsdelivr.net/pyodide/v0.24.1/full';

export interface WorkerParams {
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

export interface WorkerRequest {
  id: string;
  objBytes: ArrayBuffer;
  texBytes: ArrayBuffer;
  maskBytes: ArrayBuffer | null;
  params: WorkerParams;
}

export interface WorkerResponseOk {
  id: string;
  ok: true;
  pngBytes: ArrayBuffer;
}

export interface WorkerResponseErr {
  id: string;
  ok: false;
  error: string;
}

async function loadPyodide() {
  const { loadPyodide } = await import(/* @vite-ignore */ `${PYODIDE_INDEX}/pyodide.mjs`);
  return loadPyodide({ indexURL: PYODIDE_INDEX + '/' });
}

let pyodideInstance: Awaited<ReturnType<typeof loadPyodide>> | null = null;

async function getPyodide() {
  if (pyodideInstance) return pyodideInstance;
  const pyodide = await loadPyodide();
  await pyodide.loadPackage('numpy');
  await pyodide.runPythonAsync(`
import micropip
await micropip.install("pillow")
`);
  const base = typeof location !== 'undefined' ? location.origin : '';
  const res = await fetch(`${base}/py/seam_repair.py`);
  if (!res.ok) throw new Error('无法加载 seam_repair.py');
  const code = await res.text();
  pyodide.runPython(code);
  pyodideInstance = pyodide;
  return pyodide;
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { id, objBytes, texBytes, maskBytes, params } = e.data;
  const send = (msg: WorkerResponseOk | WorkerResponseErr) => self.postMessage(msg);

  try {
    const pyodide = await getPyodide();
    pyodide.FS.writeFile('/tmp/obj.obj', new Uint8Array(objBytes));
    pyodide.FS.writeFile('/tmp/tex.png', new Uint8Array(texBytes));
    if (maskBytes && maskBytes.byteLength > 0) {
      pyodide.FS.writeFile('/tmp/mask.png', new Uint8Array(maskBytes));
    }

    const p = params;
    const hasMask = !!(maskBytes && maskBytes.byteLength > 0);
    await pyodide.runPythonAsync(`
import io
from PIL import Image
from seam_repair import repair_texture_seams

obj_file = open("/tmp/obj.obj", "rb")
tex_img = Image.open("/tmp/tex.png")
try:
    mask_img = Image.open("/tmp/mask.png") if ${hasMask} else None
except Exception:
    mask_img = None

out_img = repair_texture_seams(
    obj_file=obj_file,
    texture_img=tex_img,
    seam_mask_img=mask_img,
    texture_kind=${JSON.stringify(p.texture_kind)},
    band_px=${p.band_px},
    feather_px=${p.feather_px},
    sample_step_px=${p.sample_step_px},
    mode=${JSON.stringify(p.mode)},
    only_masked_seams=${p.only_masked_seams},
    alpha_method=${JSON.stringify(p.alpha_method)},
    alpha_edge_aware=${p.alpha_edge_aware},
    guided_eps=${p.guided_eps},
    color_match=${JSON.stringify(p.color_match)},
    poisson_iters=${p.poisson_iters},
)
obj_file.close()
buf = io.BytesIO()
out_img.save(buf, format="PNG")
with open("/tmp/out.png", "wb") as f:
    f.write(buf.getvalue())
`);
    const outData = pyodide.FS.readFile('/tmp/out.png');
    pyodide.FS.unlink('/tmp/obj.obj');
    pyodide.FS.unlink('/tmp/tex.png');
    try { pyodide.FS.unlink('/tmp/mask.png'); } catch {}
    pyodide.FS.unlink('/tmp/out.png');

    const buf = outData.buffer as ArrayBuffer;
    self.postMessage({ id, ok: true, pngBytes: buf }, [buf]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    send({ id, ok: false, error: msg });
  }
};
