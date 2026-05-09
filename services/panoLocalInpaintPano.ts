import * as THREE from 'three';
import type { PanoLocalReprojectSnapshot } from './panoViewportProjection';
import type { PanoViewportCropNorm } from '../types';
import { expandPixelBBox, LOCAL_INPAINT_EXPAND_RATIO } from './localInpaintGemini';
import {
  equirectUvToWorldPosOnFlippedPanoSphere,
  wrap01PanoU,
  worldDirOnFlippedPanoSphereToEquirectUv,
} from './panoEquirectThreeMapping';

const SPHERE_R = 500;
const SPHERE = new THREE.Sphere(new THREE.Vector3(0, 0, 0), SPHERE_R);

/** 贴回画布单边上限（避免 8k×4k 等拖垮内存/耗时） */
const PANO_COMPOSITE_MAX_LONG_EDGE = 8192;
/** 贴回画布总像素上限（约 32MP） */
const PANO_COMPOSITE_MAX_PIXELS = 32 * 1024 * 1024;
/** 相对快照扩边框，生成图单边放大倍数上限 */
const PANO_COMPOSITE_MAX_UPSCALE = 8;

/** u∈[0,1) 在接缝处环绕：返回覆盖所有采样点的最短弧长 / 1 */
function circularSpan01(usRaw: number[]): number {
  const us = usRaw.map((u) => wrap01PanoU(u));
  if (us.length < 2) return 1e-6;
  const twoPi = Math.PI * 2;
  const angles = us.map((u) => u * twoPi);
  angles.sort((a, b) => a - b);
  const n = angles.length;
  let maxGap = 0;
  for (let i = 0; i < n; i++) {
    const cur = angles[i]!;
    const nxt = i + 1 < n ? angles[i + 1]! : angles[0]! + twoPi;
    maxGap = Math.max(maxGap, nxt - cur);
  }
  return Math.max(1e-6, (twoPi - maxGap) / twoPi);
}

/**
 * 扩边框在「当前底图分辨率」等距柱上大约占多少像素。
 * 模型常返回与裁切同尺寸的图，此时 patch/扩边框=1，但仍需放大贴回画布（同视角多快照像素压到少量 equirect 格子上）。
 */
export function estimatePanoPatchEquirectFootprintPx(
  expandedRectPx: { left: number; top: number; width: number; height: number },
  reproject: PanoLocalReprojectSnapshot,
  baseW: number,
  baseH: number
): { fw: number; fh: number } | null {
  if (baseW < 1 || baseH < 1) return null;
  const { left, top, width: ew, height: eh } = expandedRectPx;
  if (ew < 1 || eh < 1) return null;
  const cx = (x: number, y: number) => equirectNormFromSnapshotPixel(x, y, reproject);
  const samples: { u: number; v: number }[] = [];
  const pts: [number, number][] = [
    [left + 0.5, top + 0.5],
    [left + ew - 0.5, top + 0.5],
    [left + 0.5, top + eh - 0.5],
    [left + ew - 0.5, top + eh - 0.5],
    [left + ew / 2, top + 0.5],
    [left + ew / 2, top + eh - 0.5],
    [left + 0.5, top + eh / 2],
    [left + ew - 0.5, top + eh / 2],
  ];
  for (const [sx, sy] of pts) {
    const uv = cx(sx, sy);
    if (uv) samples.push({ u: uv.x, v: uv.y });
  }
  if (samples.length < 2) return null;
  const spanU = circularSpan01(samples.map((s) => s.u));
  const vs = samples.map((s) => s.v);
  const vmin = Math.min(...vs);
  const vmax = Math.max(...vs);
  const spanV = Math.max(1e-6, Math.min(1, vmax - vmin));
  const fw = Math.max(1, Math.round(spanU * baseW));
  const fh = Math.max(1, Math.round(spanV * baseH));
  return { fw, fh };
}

/**
 * 抬高等距柱贴回分辨率，避免多 patch 像素写入同一底图像素而发糊。
 * 同时考虑：① 生成图大于扩边框；② 生成图等于扩边框但 footprint（等距柱上跨度）小于扩边框像素（常见）。
 */
export function computePanoCompositeUpscaleFactor(
  baseW: number,
  baseH: number,
  expandedW: number,
  expandedH: number,
  patchW: number,
  patchH: number,
  footprintW: number,
  footprintH: number
): number {
  if (baseW < 1 || baseH < 1 || expandedW < 1 || expandedH < 1 || patchW < 1 || patchH < 1) return 1;
  if (footprintW < 1 || footprintH < 1) return 1;
  const fPatchVsExpanded = Math.max(patchW / expandedW, patchH / expandedH);
  const fPatchVsFootprint = Math.max(patchW / footprintW, patchH / footprintH);
  let f = Math.max(1, fPatchVsExpanded, fPatchVsFootprint);
  f = Math.min(f, PANO_COMPOSITE_MAX_UPSCALE);
  const capW = PANO_COMPOSITE_MAX_LONG_EDGE / baseW;
  const capH = PANO_COMPOSITE_MAX_LONG_EDGE / baseH;
  const capPx = Math.sqrt(PANO_COMPOSITE_MAX_PIXELS / (baseW * baseH));
  f = Math.min(f, capW, capH, capPx);
  return Math.max(1, f);
}

function makeReprojectCamera(snap: PanoLocalReprojectSnapshot): THREE.PerspectiveCamera {
  const { fovDeg, aspect, cameraPosition, cameraQuaternion } = snap;
  const cam = new THREE.PerspectiveCamera(fovDeg, aspect, 0.1, 2000);
  cam.position.set(cameraPosition[0], cameraPosition[1], cameraPosition[2]);
  cam.quaternion.set(cameraQuaternion[0], cameraQuaternion[1], cameraQuaternion[2], cameraQuaternion[3]);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  return cam;
}

/** 等距柱输出像素中心 (ix,iy) → 快照缓冲中的浮点像素 (sx,sy)，与 `equirectNormFromSnapshotPixel` 互逆 */
function snapshotPixelFromEquirectOutputPixel(
  ix: number,
  iy: number,
  outW: number,
  outH: number,
  cam: THREE.PerspectiveCamera,
  bufferW: number,
  bufferH: number
): { sx: number; sy: number } | null {
  if (outW < 1 || outH < 1 || bufferW < 1 || bufferH < 1) return null;
  const uu = wrap01PanoU((ix + 0.5) / outW);
  const vv = THREE.MathUtils.clamp(1 - (iy + 0.5) / outH, 0, 1);
  const wpos = equirectUvToWorldPosOnFlippedPanoSphere(uu, vv, SPHERE_R);
  const projected = wpos.project(cam);
  const ndcX = projected.x;
  const ndcY = projected.y;
  const ndcZ = projected.z;
  if (ndcZ < -1 || ndcZ > 1 || ndcX < -1.02 || ndcX > 1.02 || ndcY < -1.02 || ndcY > 1.02) return null;
  const sx = bufferW * (ndcX * 0.5 + 0.5) - 0.5;
  const sy = bufferH * (1 - ndcY) * 0.5 - 0.5;
  return { sx, sy };
}

/** 扩边框在输出等距柱上的轴对齐包围盒（像素），带 padding；跨接缝时退化为整行宽。 */
function equirectPatchOutputBboxPx(
  expandedRectPx: { left: number; top: number; width: number; height: number },
  reproject: PanoLocalReprojectSnapshot,
  outW: number,
  outH: number,
  padPx: number
): { x0: number; y0: number; x1: number; y1: number } | null {
  if (outW < 1 || outH < 1) return null;
  const { left, top, width: ew, height: eh } = expandedRectPx;
  if (ew < 1 || eh < 1) return null;
  const pts: [number, number][] = [
    [left + 0.5, top + 0.5],
    [left + ew - 0.5, top + 0.5],
    [left + 0.5, top + eh - 0.5],
    [left + ew - 0.5, top + eh - 0.5],
    [left + ew / 2, top + 0.5],
    [left + ew / 2, top + eh - 0.5],
    [left + 0.5, top + eh / 2],
    [left + ew - 0.5, top + eh / 2],
  ];
  let minIx = Infinity;
  let maxIx = -Infinity;
  let minIy = Infinity;
  let maxIy = -Infinity;
  let any = false;
  for (const [sx, sy] of pts) {
    const uv = equirectNormFromSnapshotPixel(sx, sy, reproject);
    if (!uv) continue;
    any = true;
    const ix = Math.floor(wrap01PanoU(uv.x) * outW);
    const iy = Math.floor((1 - THREE.MathUtils.clamp(uv.y, 0, 1)) * outH);
    const cix = THREE.MathUtils.clamp(ix, 0, outW - 1);
    const ciy = THREE.MathUtils.clamp(iy, 0, outH - 1);
    minIx = Math.min(minIx, cix);
    maxIx = Math.max(maxIx, cix);
    minIy = Math.min(minIy, ciy);
    maxIy = Math.max(maxIy, ciy);
  }
  if (!any || !Number.isFinite(minIx)) return null;
  let spanW = maxIx - minIx + 1;
  if (spanW > outW / 2) {
    minIx = 0;
    maxIx = outW - 1;
  }
  const p = Math.max(0, Math.round(padPx));
  return {
    x0: THREE.MathUtils.clamp(minIx - p, 0, outW - 1),
    y0: THREE.MathUtils.clamp(minIy - p, 0, outH - 1),
    x1: THREE.MathUtils.clamp(maxIx + p, 0, outW - 1),
    y1: THREE.MathUtils.clamp(maxIy + p, 0, outH - 1),
  };
}

function samplePatchBilinear(
  pd: Uint8ClampedArray,
  pw: number,
  ph: number,
  px: number,
  py: number
): [number, number, number, number] {
  const x = THREE.MathUtils.clamp(px, 0, pw - 1);
  const y = THREE.MathUtils.clamp(py, 0, ph - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, pw - 1);
  const y1 = Math.min(y0 + 1, ph - 1);
  const fx = x - x0;
  const fy = y - y0;
  const idx = (xi: number, yi: number) => (yi * pw + xi) * 4;
  const s = (xi: number, yi: number) => {
    const i = idx(xi, yi);
    return [pd[i]!, pd[i + 1]!, pd[i + 2]!, pd[i + 3]!] as const;
  };
  const c00 = s(x0, y0);
  const c10 = s(x1, y0);
  const c01 = s(x0, y1);
  const c11 = s(x1, y1);
  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;
  const mix = (k: 0 | 1 | 2 | 3) =>
    c00[k] * w00 + c10[k] * w10 + c01[k] * w01 + c11[k] * w11;
  return [mix(0), mix(1), mix(2), mix(3)];
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
  const { bufferW, bufferH } = snap;
  if (bufferW < 1 || bufferH < 1) return null;
  const ndcX = ((sx + 0.5) / bufferW) * 2 - 1;
  const ndcY = -(((sy + 0.5) / bufferH) * 2 - 1);
  const cam = makeReprojectCamera(snap);
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), cam);
  const hit = new THREE.Vector3();
  if (!raycaster.ray.intersectSphere(SPHERE, hit)) return null;
  const { u, v } = worldDirOnFlippedPanoSphereToEquirectUv(hit);
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

  /** 解码图尺寸须与 `bufferW/H` 一致；`aspect` 必须与像素宽高比一致，否则反投影射线与快照像素不对齐 */
  const rep: PanoLocalReprojectSnapshot = { ...reproject, bufferW: iw, bufferH: ih, aspect: iw / ih };

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

export type CompositePanoPatchOntoEquirectOptions = {
  /** 为 true：内部先抬升分辨率贴回，再高质量缩小到原底图尺寸 */
  shrinkToBaseDimensions?: boolean;
};

export async function compositePanoPatchOntoEquirect(
  baseEquirectSrc: string,
  patchDataUrl: string,
  expandedRectPx: { left: number; top: number; width: number; height: number },
  reproject: PanoLocalReprojectSnapshot,
  featherPx: number,
  options?: CompositePanoPatchOntoEquirectOptions
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

  const foot =
    estimatePanoPatchEquirectFootprintPx(expandedRectPx, reproject, nw, nh) ??
    ({ fw: pw, fh: ph } as const);
  const scaleF = computePanoCompositeUpscaleFactor(
    nw,
    nh,
    pw,
    ph,
    patch.naturalWidth,
    patch.naturalHeight,
    foot.fw,
    foot.fh
  );
  const outW = Math.max(1, Math.round(nw * scaleF));
  const outH = Math.max(1, Math.round(nh * scaleF));

  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const octx = out.getContext('2d');
  if (!octx) return null;
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(base, 0, 0, nw, nh, 0, 0, outW, outH);
  const baseData = octx.getImageData(0, 0, outW, outH);

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
  const { bufferW, bufferH } = reproject;
  const cam = makeReprojectCamera(reproject);
  const bbox =
    equirectPatchOutputBboxPx(expandedRectPx, reproject, outW, outH, 3) ??
    ({ x0: 0, y0: 0, x1: outW - 1, y1: outH - 1 } as const);

  /**
   * 逆映射：对每个输出等距柱像素求快照坐标并双线性采样 patch，避免前向 splat+floor 造成的规则网格 / 径向条纹。
   */
  for (let iy = bbox.y0; iy <= bbox.y1; iy += 1) {
    for (let ix = bbox.x0; ix <= bbox.x1; ix += 1) {
      const sp = snapshotPixelFromEquirectOutputPixel(ix, iy, outW, outH, cam, bufferW, bufferH);
      if (!sp) continue;
      const { sx, sy } = sp;
      const pxi = sx - left;
      const pyi = sy - top;
      if (pxi < 0 || pxi >= pw || pyi < 0 || pyi >= ph) continue;
      const [pr, pg, pb, pa] = samplePatchBilinear(pd, pw, ph, pxi, pyi);
      let a = pa / 255;
      if (fMax > 0) {
        const dist = Math.min(pxi, pyi, pw - pxi, ph - pyi);
        if (dist < fMax) {
          a *= dist / fMax;
        }
      }
      if (a < 1 / 255) continue;

      const bi = (iy * outW + ix) * 4;
      const inv = 1 - a;
      bd[bi] = Math.round(bd[bi]! * inv + pr * a);
      bd[bi + 1] = Math.round(bd[bi + 1]! * inv + pg * a);
      bd[bi + 2] = Math.round(bd[bi + 2]! * inv + pb * a);
      bd[bi + 3] = 255;
    }
  }

  octx.putImageData(baseData, 0, 0);

  let exportCanvas: HTMLCanvasElement = out;
  if (options?.shrinkToBaseDimensions && (outW !== nw || outH !== nh)) {
    const fin = document.createElement('canvas');
    fin.width = nw;
    fin.height = nh;
    const fctx = fin.getContext('2d');
    if (!fctx) return null;
    fctx.imageSmoothingEnabled = true;
    fctx.imageSmoothingQuality = 'high';
    fctx.drawImage(out, 0, 0, outW, outH, 0, 0, nw, nh);
    exportCanvas = fin;
  }

  try {
    return exportCanvas.toDataURL('image/png');
  } catch {
    return null;
  }
}
