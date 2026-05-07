/**
 * 大图预览：指针坐标与 <img object-contain> 内容区对齐，并修正祖先 CSS transform（scale）导致的视口/布局像素比。
 */

import type { ImageLocalEditSelection } from '../types';
import { tightPixelBBoxForLocalEdit } from './localInpaintGemini';

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
/** 平面预览：光标下图像素 RGB（不含 alpha） */
export type ImagePixelRgb = { r: number; g: number; b: number };

/**
 * 将视口坐标映射到原图像素索引（仅在 object-contain 内容区内有效，区外返回 null）。
 */
export function imageNaturalIndicesFromClientPoint(
  img: HTMLImageElement,
  clientX: number,
  clientY: number
): { ix: number; iy: number } | null {
  const m = getImgObjectContainMetrics(img);
  if (!m) return null;
  const local = clientPointToElementLocal(clientX, clientY, img);
  const { nx, ny, inside } = localToNaturalPoint(local.x, local.y, m);
  if (!inside) return null;
  const ix = Math.min(m.nw - 1, Math.max(0, Math.floor(nx)));
  const iy = Math.min(m.nh - 1, Math.max(0, Math.floor(ny)));
  return { ix, iy };
}

/** 从已绘制好的离屏 canvas 读取单像素 RGB（跨域脏画布时返回 null） */
export function readRgbFromCanvas(canvas: HTMLCanvasElement, ix: number, iy: number): ImagePixelRgb | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  try {
    const d = ctx.getImageData(ix, iy, 1, 1).data;
    return { r: d[0]!, g: d[1]!, b: d[2]! };
  } catch {
    return null;
  }
}

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

/**
 * 局部重绘选区紧包围盒底边中点 → 视口 client 坐标（用于快捷栏锚在框下方）。
 */
export function localEditSelectionBottomCenterClient(
  img: HTMLImageElement,
  sel: ImageLocalEditSelection
): { x: number; y: number } | null {
  const m = getImgObjectContainMetrics(img);
  if (!m) return null;
  const tight = tightPixelBBoxForLocalEdit(sel, m.nw, m.nh);
  const nx = tight.x + tight.w / 2;
  const ny = tight.y + tight.h;
  const lx = m.offsetX + (nx / m.nw) * m.drawW;
  const ly = m.offsetY + (ny / m.nh) * m.drawH;
  const rect = img.getBoundingClientRect();
  const sx = img.clientWidth > 0 ? rect.width / img.clientWidth : 1;
  const sy = img.clientHeight > 0 ? rect.height / img.clientHeight : 1;
  return { x: rect.left + lx * sx, y: rect.top + ly * sy };
}
