/** 位移贴图最长边上限（提高可减轻置换「台阶」与轮廓锯齿） */
export const IMAGE_HEIGHTFIELD_DISPLACE_MAX_EDGE = 2048;

/** 颜色贴图最长边上限（略高于位移，保留表面着色细节） */
export const IMAGE_HEIGHTFIELD_COLOR_MAX_EDGE = 2560;

/**
 * 将 sRGB 0–255 像素转为标量高度（0–1），与常见「亮度当高度」一致，兼容 AI 生成的 RGB 图。
 */
export function rgbToHeightLuminance(r: number, g: number, b: number): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function rgbToHeightFromBuffer(buf: Uint8ClampedArray, sw: number, sh: number, x: number, y: number): number {
  const xi = Math.max(0, Math.min(sw - 1, Math.floor(x)));
  const yi = Math.max(0, Math.min(sh - 1, Math.floor(y)));
  const si = (yi * sw + xi) * 4;
  return rgbToHeightLuminance(buf[si] ?? 0, buf[si + 1] ?? 0, buf[si + 2] ?? 0);
}

/** 双线性采样高度（0–1），缩小位移贴图时比最近邻更平滑，减轻斜面锯齿感 */
export function sampleHeightBilinear(buf: Uint8ClampedArray, sw: number, sh: number, fx: number, fy: number): number {
  if (sw <= 1 || sh <= 1) return rgbToHeightFromBuffer(buf, sw, sh, 0, 0);
  const x = Math.max(0, Math.min(sw - 1, fx));
  const y = Math.max(0, Math.min(sh - 1, fy));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(sw - 1, x0 + 1);
  const y1 = Math.min(sh - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const h00 = rgbToHeightFromBuffer(buf, sw, sh, x0, y0);
  const h10 = rgbToHeightFromBuffer(buf, sw, sh, x1, y0);
  const h01 = rgbToHeightFromBuffer(buf, sw, sh, x0, y1);
  const h11 = rgbToHeightFromBuffer(buf, sw, sh, x1, y1);
  const a = h00 * (1 - tx) + h10 * tx;
  const b = h01 * (1 - tx) + h11 * tx;
  return a * (1 - ty) + b * ty;
}

export type HeightfieldDisplacementCanvasResult = {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
};

/**
 * 从已解码的位图生成单通道灰度 Canvas（R=G=B=高度），供 CPU 顶点抬升或离屏采样。
 */
export function buildHeightfieldDisplacementCanvas(
  source: CanvasImageSource,
  sw: number,
  sh: number,
  opts?: { maxEdge?: number }
): HeightfieldDisplacementCanvasResult {
  const maxEdge = opts?.maxEdge ?? IMAGE_HEIGHTFIELD_DISPLACE_MAX_EDGE;
  if (!sw || !sh) {
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    const x = c.getContext('2d');
    if (x) {
      x.fillStyle = '#808080';
      x.fillRect(0, 0, 1, 1);
    }
    return { canvas: c, width: 1, height: 1 };
  }
  const scale = Math.min(1, maxEdge / Math.max(sw, sh));
  const tw = Math.max(1, Math.floor(sw * scale));
  const th = Math.max(1, Math.floor(sh * scale));
  const full = document.createElement('canvas');
  full.width = sw;
  full.height = sh;
  const fctx = full.getContext('2d', { willReadFrequently: true });
  if (!fctx) {
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    return { canvas: c, width: 1, height: 1 };
  }
  fctx.drawImage(source, 0, 0, sw, sh);
  let data: ImageData;
  try {
    data = fctx.getImageData(0, 0, sw, sh);
  } catch {
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    return { canvas: c, width: 1, height: 1 };
  }
  const out = document.createElement('canvas');
  out.width = tw;
  out.height = th;
  const octx = out.getContext('2d');
  if (!octx) return { canvas: out, width: tw, height: th };
  const outImg = octx.createImageData(tw, th);
  const srcBuf = data.data;
  const dstBuf = outImg.data;
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const fx = tw <= 1 ? 0 : ((x + 0.5) / tw) * (sw - 1);
      const fy = th <= 1 ? 0 : ((y + 0.5) / th) * (sh - 1);
      const h = sampleHeightBilinear(srcBuf, sw, sh, fx, fy);
      const v = Math.round(h * 255);
      const di = (y * tw + x) * 4;
      dstBuf[di] = v;
      dstBuf[di + 1] = v;
      dstBuf[di + 2] = v;
      dstBuf[di + 3] = 255;
    }
  }
  octx.putImageData(outImg, 0, 0);
  return { canvas: out, width: tw, height: th };
}

/**
 * 为表面着色降采样后的 RGBA Canvas（仍保留颜色）。
 */
export function buildHeightfieldColorCanvas(
  source: CanvasImageSource,
  sw: number,
  sh: number,
  opts?: { maxEdge?: number }
): HeightfieldDisplacementCanvasResult {
  const maxEdge = opts?.maxEdge ?? IMAGE_HEIGHTFIELD_COLOR_MAX_EDGE;
  if (!sw || !sh) {
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    return { canvas: c, width: 1, height: 1 };
  }
  const scale = Math.min(1, maxEdge / Math.max(sw, sh));
  const tw = Math.max(1, Math.floor(sw * scale));
  const th = Math.max(1, Math.floor(sh * scale));
  const c = document.createElement('canvas');
  c.width = tw;
  c.height = th;
  const ctx = c.getContext('2d');
  if (!ctx) return { canvas: c, width: tw, height: th };
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, sw, sh, 0, 0, tw, th);
  return { canvas: c, width: tw, height: th };
}

/**
 * 位移平面细分：与位移贴图分辨率大致成比例，并限制总格子数，避免顶点数爆炸。
 */
export function clampHeightfieldPlaneSegments(
  dw: number,
  dh: number,
  maxCells: number = 380_000
): { segX: number; segY: number } {
  const w = Math.max(1, Math.floor(dw));
  const h = Math.max(1, Math.floor(dh));
  let segX = Math.min(640, Math.max(96, Math.round(w * 0.92)));
  let segY = Math.min(640, Math.max(96, Math.round(h * 0.92)));
  while (segX * segY > maxCells && (segX > 96 || segY > 96)) {
    if (segX >= segY && segX > 96) segX = Math.max(96, Math.floor(segX * 0.9));
    else segY = Math.max(96, Math.floor(segY * 0.9));
  }
  return { segX, segY };
}

/** 与 `PlaneGeometry` 默认 UV 一致：u 水平 0→1，v=1 为纹理上沿（与 Canvas 首行对齐） */
export type HeightfieldGrayDispData = {
  data: Uint8ClampedArray;
  w: number;
  h: number;
};

export function readHeightfieldDispGrayPixels(dispCanvas: HTMLCanvasElement): HeightfieldGrayDispData | null {
  const w = dispCanvas.width;
  const h = dispCanvas.height;
  if (w < 1 || h < 1) return null;
  const ctx = dispCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  try {
    const id = ctx.getImageData(0, 0, w, h);
    return { data: id.data, w, h };
  } catch {
    return null;
  }
}

/** 双线性采样灰度高度 0～1（取 R 通道） */
export function sampleGrayDispBilinear(img: HeightfieldGrayDispData, u: number, v: number): number {
  const { data, w: tw, h: th } = img;
  if (tw < 1 || th < 1) return 0;
  const uu = Math.max(0, Math.min(1, u));
  const vv = Math.max(0, Math.min(1, v));
  const fx = uu * (tw - 1);
  const fy = (1 - vv) * (th - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(tw - 1, x0 + 1);
  const y1 = Math.min(th - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const g = (xx: number, yy: number) => (data[(yy * tw + xx) * 4] ?? 128) / 255;
  return g(x0, y0) * (1 - tx) * (1 - ty) + g(x1, y0) * tx * (1 - ty) + g(x0, y1) * (1 - tx) * ty + g(x1, y1) * tx * ty;
}
