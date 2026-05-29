import type { StoryboardParseFieldDef } from '../types';

export type StoryboardVideoOverlayLine = {
  fieldId: string;
  label: string;
  value: string;
};

/** 视频预览/导出：catalog 内全部有值字段，按 order 叠加 */
export function buildStoryboardVideoOverlayLines(
  shotFields: Record<string, string>,
  catalog: StoryboardParseFieldDef[]
): StoryboardVideoOverlayLine[] {
  if (!catalog.length) return [];
  return [...catalog]
    .sort((a, b) => a.order - b.order)
    .map((f) => ({
      fieldId: f.id,
      label: f.label,
      value: String(shotFields[f.id] || '').trim(),
    }))
    .filter((line) => line.value.length > 0);
}
