/**
 * 大图预览：指针坐标与 <img object-contain> 内容区对齐，并修正祖先 CSS transform（scale）导致的视口/布局像素比。
 */

export type ImageContentMetrics = {
  nw: number;
  nh: number;
  offsetX: number;
  offsetY: number;
  drawW: number;
  drawH: number;
};

export function getImgObjectContainMetrics(img: HTMLImageElement): ImageContentMetrics | null {
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  if (!nw || !nh) return null;
  const cw = img.clientWidth;
  const ch = img.clientHeight;
  if (!cw || !ch) return null;
  const ir = nw / nh;
  const cr = cw / ch;
  let drawW: number;
  let drawH: number;
  let offsetX: number;
  let offsetY: number;
  if (ir > cr) {
    drawW = cw;
    drawH = cw / ir;
    offsetX = 0;
    offsetY = (ch - drawH) / 2;
  } else {
    drawH = ch;
    drawW = ch * ir;
    offsetX = (cw - drawW) / 2;
    offsetY = 0;
  }
  return { nw, nh, offsetX, offsetY, drawW, drawH };
}

/** 将指针位置映射到元素「布局 CSS 像素」坐标（抵消 getBoundingClientRect 与 clientWidth 之间的缩放差） */
export function clientPointToElementLocal(clientX: number, clientY: number, el: HTMLElement): { x: number; y: number } {
  const rect = el.getBoundingClientRect();
  const sx = el.clientWidth > 0 ? el.clientWidth / rect.width : 1;
  const sy = el.clientHeight > 0 ? el.clientHeight / rect.height : 1;
  return {
    x: (clientX - rect.left) * sx,
    y: (clientY - rect.top) * sy,
  };
}

/** 布局像素 → 原图像素（落在 letterbox 外则 clamp 到边缘） */
export function localToNaturalPoint(
  lx: number,
  ly: number,
  m: ImageContentMetrics
): { nx: number; ny: number; inside: boolean } {
  const x = (lx - m.offsetX) / m.drawW;
  const y = (ly - m.offsetY) / m.drawH;
  const inside = x >= 0 && x <= 1 && y >= 0 && y <= 1;
  const nx = Math.min(m.nw, Math.max(0, x * m.nw));
  const ny = Math.min(m.nh, Math.max(0, y * m.nh));
  return { nx, ny, inside };
}

export function naturalToNorm(nx: number, ny: number, m: ImageContentMetrics): { x: number; y: number } {
  return { x: nx / m.nw, y: ny / m.nh };
}

export function normToNatural(x: number, y: number, m: ImageContentMetrics): { nx: number; ny: number } {
  return { nx: x * m.nw, ny: y * m.nh };
}
