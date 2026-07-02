/** 打开工作流大图前，截取资产列表可见区域为静态 JPEG（供预览背景）。 */

export type WorkflowListScrollSnapshotOptions = {
  maxWidth?: number;
  background?: string;
  jpegQuality?: number;
};

function fillRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number
): void {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function intersectsViewport(
  inner: DOMRect,
  outer: DOMRect,
  slackPx = 2
): boolean {
  return !(
    inner.bottom < outer.top - slackPx ||
    inner.top > outer.bottom + slackPx ||
    inner.right < outer.left - slackPx ||
    inner.left > outer.right + slackPx
  );
}

function isCanvasSafeImageSrc(src: string): boolean {
  const s = src.trim();
  if (!s) return false;
  const lower = s.toLowerCase();
  if (lower.startsWith('data:') || lower.startsWith('blob:')) return true;
  if (typeof window === 'undefined') return false;
  try {
    const url = new URL(s, window.location.href);
    return url.origin === window.location.origin;
  } catch {
    return false;
  }
}

function paintWorkflowListScrollSnapshot(
  ctx: CanvasRenderingContext2D,
  scrollEl: HTMLElement,
  rect: DOMRect,
  scale: number,
  drawImages: boolean,
  background: string
): void {
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, cw, ch);

  const cards = scrollEl.querySelectorAll<HTMLElement>('[data-workflow-card]');
  for (const card of cards) {
    const cardRect = card.getBoundingClientRect();
    if (!intersectsViewport(cardRect, rect)) continue;

    const x = (cardRect.left - rect.left) * scale;
    const y = (cardRect.top - rect.top) * scale;
    const w = Math.max(1, cardRect.width * scale);
    const h = Math.max(1, cardRect.height * scale);
    const radius = Math.min(12 * scale, w / 2, h / 2);

    ctx.fillStyle = '#16161a';
    fillRoundRect(ctx, x, y, w, h, radius);
    ctx.fill();

    if (!drawImages) continue;

    const img = card.querySelector('img');
    if (!img || !img.complete || img.naturalWidth <= 0) continue;
    if (!isCanvasSafeImageSrc(img.currentSrc || img.src)) continue;

    const imgRect = img.getBoundingClientRect();
    if (!intersectsViewport(imgRect, rect)) continue;

    const ix = (imgRect.left - rect.left) * scale;
    const iy = (imgRect.top - rect.top) * scale;
    const iw = Math.max(1, imgRect.width * scale);
    const ih = Math.max(1, imgRect.height * scale);
    const pad = Math.min(2 * scale, w / 4, h / 4);

    try {
      ctx.save();
      fillRoundRect(ctx, x + pad, y + pad, w - pad * 2, h - pad * 2, Math.max(0, radius - pad));
      ctx.clip();
      ctx.drawImage(img, ix, iy, iw, ih);
      ctx.restore();
    } catch {
      /* drawImage 失败时仍保留卡片底色 */
    }
  }
}

/**
 * 同步截取 scroll 容器当前视口内卡片缩略图（卸载列表前调用）。
 * 跨域图跳过绘制；若 canvas 仍被污染则回退为仅卡片占位。
 */
export function captureWorkflowListScrollSnapshot(
  scrollEl: HTMLElement,
  options: WorkflowListScrollSnapshotOptions = {}
): string | null {
  if (typeof document === 'undefined') return null;

  const rect = scrollEl.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  if (width < 8 || height < 8) return null;

  const maxWidth = options.maxWidth ?? 1280;
  const scale = width > maxWidth ? maxWidth / width : 1;
  const cw = Math.max(1, Math.floor(width * scale));
  const ch = Math.max(1, Math.floor(height * scale));
  const background = options.background ?? '#0b0b0d';
  const jpegQuality = options.jpegQuality ?? 0.78;

  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  paintWorkflowListScrollSnapshot(ctx, scrollEl, rect, scale, true, background);

  try {
    return canvas.toDataURL('image/jpeg', jpegQuality);
  } catch {
    paintWorkflowListScrollSnapshot(ctx, scrollEl, rect, scale, false, background);
    try {
      return canvas.toDataURL('image/jpeg', jpegQuality);
    } catch {
      return null;
    }
  }
}

/** 读取网格卡片上已解码的缩略图，供大图 progressive 占位 */
export function pickWorkflowCardPlaceholderSrc(
  scrollEl: HTMLElement,
  thumbKey: string
): string | null {
  const key = String(thumbKey || '').trim();
  if (!key) return null;
  const host = scrollEl.querySelector(`[data-workflow-thumb-key="${CSS.escape(key)}"]`);
  const img = host?.querySelector('img');
  if (!(img instanceof HTMLImageElement)) return null;
  const src = (img.currentSrc || img.src || '').trim();
  return src || null;
}
