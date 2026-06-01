import type { StoryboardFrameRoleMark } from '../types';

const markId = () => Math.random().toString(36).slice(2, 11);

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
