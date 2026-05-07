import type {
  ImageOverlayBrushItem,
  ImageOverlayRectItem,
  ImageOverlayTextItem,
} from '../types';

/**
 * 在已建立像素坐标系的 canvas 上绘制标注项（先画底图再调用本函数）。
 * `offsetX/offsetY`：将「全图像素坐标」平移到当前 canvas 左上角（矩形裁切为 `-left,-top`；多边形裁切与 `setTransform(-minX,-minY)` 合用时多为 `0,0`）。
 */
export function drawImageOverlayItemsOnCanvas(
  ctx: CanvasRenderingContext2D,
  items: Array<ImageOverlayRectItem | ImageOverlayBrushItem | ImageOverlayTextItem>,
  nw: number,
  nh: number,
  offsetX: number,
  offsetY: number
): void {
  for (const it of items) {
    if (it.kind === 'rect') {
      ctx.save();
      ctx.strokeStyle = it.stroke;
      ctx.lineWidth = it.sw;
      ctx.strokeRect(it.x * nw + offsetX, it.y * nh + offsetY, it.w * nw, it.h * nh);
      ctx.restore();
      continue;
    }
    if (it.kind === 'brush') {
      if (it.points.length < 2) continue;
      ctx.save();
      ctx.strokeStyle = it.stroke;
      ctx.lineWidth = it.sw;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      const p0 = it.points[0]!;
      ctx.moveTo(p0.x * nw + offsetX, p0.y * nh + offsetY);
      for (let i = 1; i < it.points.length; i++) {
        const q = it.points[i]!;
        ctx.lineTo(q.x * nw + offsetX, q.y * nh + offsetY);
      }
      ctx.stroke();
      ctx.restore();
      continue;
    }
    ctx.save();
    const x = it.x * nw + offsetX;
    const y = it.y * nh + offsetY;
    const fontPx = Math.max(8, it.size);
    ctx.font = `${fontPx}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.textBaseline = 'alphabetic';
    ctx.lineWidth = Math.max(1, fontPx * 0.08);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.fillStyle = it.fill;
    ctx.strokeText(it.text, x, y);
    ctx.fillText(it.text, x, y);
    ctx.restore();
  }
}
