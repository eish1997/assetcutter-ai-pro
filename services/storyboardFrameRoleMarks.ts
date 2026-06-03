import type { StoryboardFrameRoleMark, StoryboardRoleAsset } from '../types';
import { resolveRoleAssetForMark } from './storyboardRoleReplaceRedraw';
import { STORYBOARD_SHEET_HEADER_FONT_STACK } from './storyboardSheetSketchStyle';

export type StoryboardFrameRoleMarkDrawRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

const markId = () => Math.random().toString(36).slice(2, 11);

/** 标签字号 = 镜宽 × 比例；随导出/预览宽度等比放大，不设上限 */
export const STORYBOARD_FRAME_ROLE_MARK_FONT_RATIO = 0.055 * (2 / 3);

export function resolveStoryboardFrameRoleMarkFontSize(imageWidthPx: number): number {
  if (!Number.isFinite(imageWidthPx) || imageWidthPx <= 0) return 11;
  return Math.max(9, Math.round(imageWidthPx * STORYBOARD_FRAME_ROLE_MARK_FONT_RATIO));
}

export function resolveStoryboardFrameRoleMarkMetrics(imageWidthPx: number): {
  fontSize: number;
  padX: number;
  padY: number;
  radius: number;
  borderWidth: number;
} {
  const fontSize = resolveStoryboardFrameRoleMarkFontSize(imageWidthPx);
  return {
    fontSize,
    padX: Math.max(4, Math.round(fontSize * 0.45)),
    padY: Math.max(2, Math.round(fontSize * 0.25)),
    radius: Math.max(3, Math.round(fontSize * 0.28)),
    borderWidth: Math.max(1, Math.round(fontSize * 0.08)),
  };
}

export function clampStoryboardFrameRoleMarkUnit(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

export function createStoryboardFrameRoleMark(
  partial: Omit<StoryboardFrameRoleMark, 'id'> & { id?: string }
): StoryboardFrameRoleMark {
  return {
    id: partial.id?.trim() || markId(),
    name: String(partial.name ?? '').trim(),
    x: clampStoryboardFrameRoleMarkUnit(partial.x),
    y: clampStoryboardFrameRoleMarkUnit(partial.y),
    roleAssetId: partial.roleAssetId?.trim() || undefined,
  };
}

export function normalizeStoryboardFrameRoleMarks(raw: unknown): StoryboardFrameRoleMark[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const mark = item as StoryboardFrameRoleMark;
      if (!String(mark.name ?? '').trim()) return null;
      return createStoryboardFrameRoleMark({
        id: mark.id,
        name: mark.name,
        x: mark.x,
        y: mark.y,
        roleAssetId: mark.roleAssetId,
      });
    })
    .filter((item): item is StoryboardFrameRoleMark => Boolean(item));
}

export function appendStoryboardFrameRoleMark(
  existing: StoryboardFrameRoleMark[] | undefined,
  partial: Omit<StoryboardFrameRoleMark, 'id'>
): StoryboardFrameRoleMark[] {
  return [...(existing ?? []), createStoryboardFrameRoleMark(partial)];
}

export function removeStoryboardFrameRoleMark(
  marks: StoryboardFrameRoleMark[] | undefined,
  markId: string
): StoryboardFrameRoleMark[] {
  return (marks ?? []).filter((mark) => mark.id !== markId);
}

export function updateStoryboardFrameRoleMark(
  marks: StoryboardFrameRoleMark[] | undefined,
  markId: string,
  patch: Partial<Omit<StoryboardFrameRoleMark, 'id'>>
): StoryboardFrameRoleMark[] {
  return (marks ?? []).map((mark) =>
    mark.id === markId ? createStoryboardFrameRoleMark({ ...mark, ...patch, id: mark.id }) : mark
  );
}

/** 展示名优先绑定的角色资产，其次 mark.name */
export function resolveStoryboardFrameRoleMarkDisplayName(
  mark: StoryboardFrameRoleMark,
  roleAssets?: StoryboardRoleAsset[]
): string {
  if (roleAssets?.length) {
    const asset = resolveRoleAssetForMark(mark, roleAssets);
    const fromAsset = asset?.name.trim();
    if (fromAsset) return fromAsset;
  }
  return String(mark.name ?? '').trim();
}

export function rebindStoryboardFrameRoleMark(
  marks: StoryboardFrameRoleMark[] | undefined,
  markId: string,
  asset: Pick<StoryboardRoleAsset, 'id' | 'name'>
): StoryboardFrameRoleMark[] {
  const name = asset.name.trim();
  if (!name) return marks ?? [];
  return updateStoryboardFrameRoleMark(marks, markId, {
    roleAssetId: asset.id,
    name,
  });
}

export function setStoryboardFrameRoleMarkCustomName(
  marks: StoryboardFrameRoleMark[] | undefined,
  markId: string,
  name: string
): StoryboardFrameRoleMark[] {
  const trimmed = name.trim();
  if (!trimmed) return marks ?? [];
  return updateStoryboardFrameRoleMark(marks, markId, {
    name: trimmed,
    roleAssetId: undefined,
  });
}

export function duplicateStoryboardFrameRoleMarks(
  source: StoryboardFrameRoleMark[] | undefined
): StoryboardFrameRoleMark[] {
  return normalizeStoryboardFrameRoleMarks(source).map((mark) =>
    createStoryboardFrameRoleMark({
      name: mark.name,
      x: mark.x,
      y: mark.y,
      roleAssetId: mark.roleAssetId,
    })
  );
}

export function computeStoryboardFrameRoleMarkPosition(
  clientX: number,
  clientY: number,
  rect: DOMRect
): { x: number; y: number } {
  if (!rect.width || !rect.height) {
    return { x: 0.5, y: 0.5 };
  }
  return {
    x: clampStoryboardFrameRoleMarkUnit((clientX - rect.left) / rect.width),
    y: clampStoryboardFrameRoleMarkUnit((clientY - rect.top) / rect.height),
  };
}

function fillRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number
): void {
  const r = Math.min(radius, w / 2, h / 2);
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
  ctx.fill();
}

function strokeRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number
): void {
  const r = Math.min(radius, w / 2, h / 2);
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
  ctx.stroke();
}

/** 在分镜图显示区域内绘制编辑页人名标签（与画板 DOM 样式一致） */
export function drawStoryboardFrameRoleMarksOnCanvas(
  ctx: CanvasRenderingContext2D,
  marks: StoryboardFrameRoleMark[] | undefined,
  rect: StoryboardFrameRoleMarkDrawRect,
  roleAssets?: StoryboardRoleAsset[]
): void {
  if (!marks?.length || rect.w <= 0 || rect.h <= 0) return;

  const { fontSize, padX, padY, radius, borderWidth } = resolveStoryboardFrameRoleMarkMetrics(rect.w);
  const maxBadgeW = rect.w * 0.94;

  ctx.save();
  ctx.font = `700 ${fontSize}px ${STORYBOARD_SHEET_HEADER_FONT_STACK}`;

  for (const mark of marks) {
    const name = resolveStoryboardFrameRoleMarkDisplayName(mark, roleAssets);
    if (!name) continue;

    const cx = rect.x + mark.x * rect.w;
    const cy = rect.y + mark.y * rect.h;
    const textW = ctx.measureText(name).width;
    const badgeW = Math.min(maxBadgeW, textW + padX * 2);
    const badgeH = fontSize + padY * 2;
    let bx = cx - badgeW / 2;
    let by = cy - badgeH / 2;
    bx = Math.max(rect.x, Math.min(rect.x + rect.w - badgeW, bx));
    by = Math.max(rect.y, Math.min(rect.y + rect.h - badgeH, by));

    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    fillRoundedRect(ctx, bx, by, badgeW, badgeH, radius);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = borderWidth;
    strokeRoundedRect(ctx, bx + borderWidth * 0.5, by + borderWidth * 0.5, badgeW - borderWidth, badgeH - borderWidth, radius);

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, bx + badgeW / 2, by + badgeH / 2, badgeW - padX);
  }

  ctx.restore();
}
