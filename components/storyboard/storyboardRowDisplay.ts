import type { StoryboardTableRow } from '../../types';

/** 大纲列表主标题 */
export function storyboardRowOutlineTitle(row: StoryboardTableRow, index: number): string {
  const no = (row.shotNo || '').trim();
  if (no) return no;
  return String(index + 1).padStart(2, '0');
}

/** 大纲副文案（单行截断） */
export function storyboardRowOutlineSubtitle(row: StoryboardTableRow): string {
  const text = (row.shotText || '').trim();
  if (text) return text.replace(/\s+/g, ' ');
  return '（未填写镜头文本）';
}

export function storyboardRowDurationLabel(row: StoryboardTableRow): string | null {
  if (row.durationSec == null || !Number.isFinite(row.durationSec)) return null;
  return `${row.durationSec}s`;
}
