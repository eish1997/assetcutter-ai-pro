/**
 * 线分割纵向变形绘制（大图预览与导出共用）。
 * 不修改 ctx 的 transform；调用方需先 clearRect。
 */
export type SplitStretchRasterState = {
  active: boolean;
  lineFrac: number;
  splitNaturalY: number;
};

export function drawSplitPreview(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  nw: number,
  nh: number,
  splitNaturalY: number,
  lineFrac: number,
  dstW: number,
  dstH: number
): void {
  const sy = Math.min(nh - 1, Math.max(1, Math.round(splitNaturalY)));
  const w = Math.max(1, Math.round(dstW));
  const h = Math.max(1, Math.round(dstH));
  if (h < 2 || nh < 2) {
    ctx.drawImage(img, 0, 0, nw, nh, 0, 0, w, h);
    return;
  }
  let topHi = Math.round(lineFrac * h);
  topHi = Math.max(1, Math.min(h - 1, topHi));
  const botHi = h - topHi;
  if (topHi > 0 && sy > 0) {
    ctx.drawImage(img, 0, 0, nw, sy, 0, 0, w, topHi);
  }
  if (botHi > 0 && nh > sy) {
    ctx.drawImage(img, 0, sy, nw, nh - sy, 0, topHi, w, botHi);
  }
}
