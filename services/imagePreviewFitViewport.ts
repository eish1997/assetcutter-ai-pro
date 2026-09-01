/** 灯箱平面图 well 边距：顶底留白大于左右，避免贴住顶栏/输入条。 */
export const LIGHTBOX_FLAT_WELL_INSET = {
  hidden: 8,
  top: 80,
  bottom: 184,
  x: 28,
} as const;

/** 灯箱平面图：铺满 `[data-lightbox-flat-well]`，否则退回主舞台。 */

export function measureLightboxFlatFitBox(
  doc: Document | null = typeof document !== 'undefined' ? document : null,
  viewport: { width: number; height: number } = {
    width: typeof window !== 'undefined' ? window.innerWidth : 1280,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  }
): { maxW: number; maxH: number } {
  const well = doc?.querySelector<HTMLElement>('[data-lightbox-flat-well]');
  const wellRect = well?.getBoundingClientRect();
  if (wellRect && wellRect.width > 80 && wellRect.height > 80) {
    return { maxW: wellRect.width, maxH: wellRect.height };
  }
  const stage = doc?.querySelector<HTMLElement>('[data-lightbox-main-stage]');
  const stageRect = stage?.getBoundingClientRect();
  const availW = stageRect && stageRect.width > 80 ? stageRect.width : viewport.width;
  const availH = stageRect && stageRect.height > 80 ? stageRect.height : viewport.height;
  return {
    maxW: Math.max(160, availW - 16),
    maxH: Math.max(160, availH - 16),
  };
}

export function fitImageToPreviewViewport(
  nw: number,
  nh: number,
  box?: { maxW: number; maxH: number }
): { w: number; h: number } {
  if (!nw || !nh) return { w: nw, h: nh };
  const { maxW, maxH } = box ?? measureLightboxFlatFitBox();
  const s = Math.min(maxW / nw, maxH / nh);
  return { w: nw * s, h: nh * s };
}

export function lockByOriginalDominantAxis(
  nw: number,
  nh: number,
  box?: { maxW: number; maxH: number }
): { axis: 'width' | 'height'; size: number } {
  const fit = fitImageToPreviewViewport(nw, nh, box);
  const axis = nw >= nh ? 'width' : 'height';
  return { axis, size: axis === 'width' ? fit.w : fit.h };
}
