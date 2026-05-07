import * as THREE from 'three';
import type { PanoLocalReprojectSnapshot } from './panoViewportProjection';
import type { PanoViewportCropNorm } from '../types';
import { expandPixelBBox, LOCAL_INPAINT_EXPAND_RATIO } from './localInpaintGemini';

const SPHERE_R = 500;
const SPHERE = new THREE.Sphere(new THREE.Vector3(0, 0, 0), SPHERE_R);

function wrap01(u: number): number {
  let x = u % 1;
  if (x < 0) x += 1;
  return x;
}

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('image load failed'));
    im.src = src;
  });
}

/** 快照缓冲像素中心 (sx,sy) → 等距柱纹理归一化 u,v（与 EquirectangularPanoramaCanvas 射线一致） */
export function equirectNormFromSnapshotPixel(
  sx: number,
  sy: number,
  snap: PanoLocalReprojectSnapshot
): { x: number; y: number } | null {
  const { bufferW, bufferH, fovDeg, aspect, cameraPosition, cameraQuaternion } = snap;
  if (bufferW < 1 || bufferH < 1) return null;
  const ndcX = ((sx + 0.5) / bufferW) * 2 - 1;
  const ndcY = -(((sy + 0.5) / bufferH) * 2 - 1);
  const cam = new THREE.PerspectiveCamera(fovDeg, aspect, 0.1, 2000);
  cam.position.set(cameraPosition[0], cameraPosition[1], cameraPosition[2]);
  cam.quaternion.set(cameraQuaternion[0], cameraQuaternion[1], cameraQuaternion[2], cameraQuaternion[3]);
  cam.updateMatrixWorld();
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), cam);
  const hit = new THREE.Vector3();
  if (!raycaster.ray.intersectSphere(SPHERE, hit)) return null;
  const dir = hit.clone().normalize();
  const lat = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
  const lon = Math.atan2(dir.x, dir.z);
  const u = wrap01(lon / (2 * Math.PI) + 0.5);
  const v = THREE.MathUtils.clamp(0.5 - lat / Math.PI, 0, 1);
  return { x: u, y: v };
}

export type PanoLocalInpaintCropPlan = {
  cropDataUrl: string;
  expandedRectPx: { left: number; top: number; width: number; height: number };
  reproject: PanoLocalReprojectSnapshot;
  featherPx: number;
};

function clamp01n(v: number) {
  return Math.min(1, Math.max(0, v));
}

export async function rasterizePanoLocalEditCropFromSnapshot(
  snapDataUrl: string,
  viewportNorm: PanoViewportCropNorm,
  reproject: PanoLocalReprojectSnapshot,
  expandRatio = LOCAL_INPAINT_EXPAND_RATIO
): Promise<PanoLocalInpaintCropPlan | null> {
  let im: HTMLImageElement;
  try {
    im = await loadHtmlImage(snapDataUrl);
  } catch {
    return null;
  }
  const iw = im.naturalWidth;
  const ih = im.naturalHeight;
  if (!iw || !ih) return null;

  const rep: PanoLocalReprojectSnapshot = { ...reproject, bufferW: iw, bufferH: ih };

  const x0 = clamp01n(viewportNorm.x) * iw;
  const y0 = clamp01n(viewportNorm.y) * ih;
  const x1 = clamp01n(viewportNorm.x + viewportNorm.w) * iw;
  const y1 = clamp01n(viewportNorm.y + viewportNorm.h) * ih;
  const left = Math.min(x0, x1);
  const top = Math.min(y0, y1);
  const tight = {
    x: Math.max(0, Math.round(left)),
    y: Math.max(0, Math.round(top)),
    w: Math.max(1, Math.round(Math.abs(x1 - x0))),
    h: Math.max(1, Math.round(Math.abs(y1 - y0))),
  };
  const exp = expandPixelBBox(tight, iw, ih, expandRatio);
  const featherPx = Math.max(8, Math.min(64, Math.round(0.06 * Math.min(exp.w, exp.h))));

  const canvas = document.createElement('canvas');
  canvas.width = exp.w;
  canvas.height = exp.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  try {
    ctx.drawImage(im, exp.x, exp.y, exp.w, exp.h, 0, 0, exp.w, exp.h);
    return {
      cropDataUrl: canvas.toDataURL('image/png'),
      expandedRectPx: { left: exp.x, top: exp.y, width: exp.w, height: exp.h },
      reproject: rep,
      featherPx,
    };
  } catch {
    return null;
  }
}

export async function compositePanoPatchOntoEquirect(
  baseEquirectSrc: string,
  patchDataUrl: string,
  expandedRectPx: { left: number; top: number; width: number; height: number },
  reproject: PanoLocalReprojectSnapshot,
  featherPx: number
): Promise<string | null> {
  let base: HTMLImageElement;
  let patch: HTMLImageElement;
  try {
    [base, patch] = await Promise.all([loadHtmlImage(baseEquirectSrc), loadHtmlImage(patchDataUrl)]);
  } catch {
    return null;
  }
  const nw = base.naturalWidth;
  const nh = base.naturalHeight;
  if (!nw || !nh) return null;

  const pw = expandedRectPx.width;
  const ph = expandedRectPx.height;
  if (patch.naturalWidth < 1 || patch.naturalHeight < 1 || pw < 1 || ph < 1) return null;

  const out = document.createElement('canvas');
  out.width = nw;
  out.height = nh;
  const octx = out.getContext('2d');
  if (!octx) return null;
  octx.drawImage(base, 0, 0);
  const baseData = octx.getImageData(0, 0, nw, nh);

  const pc = document.createElement('canvas');
  pc.width = pw;
  pc.height = ph;
  const pctx = pc.getContext('2d');
  if (!pctx) return null;
  pctx.drawImage(patch, 0, 0, patch.naturalWidth, patch.naturalHeight, 0, 0, pw, ph);
  const pdata = pctx.getImageData(0, 0, pw, ph);
  const pd = pdata.data;
  const bd = baseData.data;

  const fMax = Math.min(featherPx, Math.floor(Math.min(pw, ph) / 4));

  const { left, top } = expandedRectPx;
  for (let py = 0; py < ph; py += 1) {
    for (let px = 0; px < pw; px += 1) {
      const sx = left + px + 0.5;
      const sy = top + py + 0.5;
      const uv = equirectNormFromSnapshotPixel(sx, sy, reproject);
      if (!uv) continue;
      const uu = wrap01(uv.x);
      const vv = THREE.MathUtils.clamp(uv.y, 0, 1);
      let ix = Math.floor(uu * nw);
      if (ix >= nw) ix = nw - 1;
      if (ix < 0) ix = 0;
      let iy = Math.floor(vv * nh);
      if (iy >= nh) iy = nh - 1;
      if (iy < 0) iy = 0;

      const pi = (py * pw + px) * 4;
      let a = pd[pi + 3]! / 255;
      if (fMax > 0) {
        const dist = Math.min(px, py, pw - 1 - px, ph - 1 - py);
        if (dist < fMax) {
          a *= dist / fMax;
        }
      }
      if (a < 1 / 255) continue;

      const bi = (iy * nw + ix) * 4;
      const inv = 1 - a;
      bd[bi] = Math.round(bd[bi]! * inv + pd[pi]! * a);
      bd[bi + 1] = Math.round(bd[bi + 1]! * inv + pd[pi + 1]! * a);
      bd[bi + 2] = Math.round(bd[bi + 2]! * inv + pd[pi + 2]! * a);
      bd[bi + 3] = 255;
    }
  }

  octx.putImageData(baseData, 0, 0);
  try {
    return out.toDataURL('image/png');
  } catch {
    return null;
  }
}
