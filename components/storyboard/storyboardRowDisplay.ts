import type { StoryboardParseFieldDef, StoryboardTableRow } from '../../types';
import { compileShotText, pickPrimaryVisualField } from '../../services/storyboardTableParse';
import {
  storyboardGroupCompositeFieldItems as groupFieldItems,
  storyboardShotCompositeFieldItems,
  type StoryboardCompositeFieldItem,
} from '../../services/storyboardCompositeFields';

export type { StoryboardCompositeFieldItem };

/** 大纲列表主标题 */
export function storyboardRowOutlineTitle(row: StoryboardTableRow, index: number): string {
  const no = (row.shotNo || '').trim();
  if (no) return no;
  return String(index + 1).padStart(2, '0');
}

/** 大纲副文案（单行截断） */
export function storyboardRowOutlineSubtitle(
  row: StoryboardTableRow,
  catalog: StoryboardParseFieldDef[] = []
): string {
  const primary = pickPrimaryVisualField(catalog, row.shotFields);
  if (primary?.value) return primary.value.replace(/\s+/g, ' ');
  const text = (row.shotText || '').trim();
  if (text) return text.replace(/\s+/g, ' ');
  return '（未填写）';
}

export function storyboardRowDurationLabel(row: StoryboardTableRow): string | null {
  if (row.durationSec == null || !Number.isFinite(row.durationSec)) return null;
  return `${row.durationSec}s`;
}

export function storyboardRowPrimaryVisualText(
  row: StoryboardTableRow,
  catalog: StoryboardParseFieldDef[] = []
): string {
  return pickPrimaryVisualField(catalog, row.shotFields)?.value ?? '';
}

/** 分镜合成卡正文：结构化全字段 + 回退 shotText / shotRaw */
export function storyboardRowCompositeBodyText(
  row: StoryboardTableRow,
  catalog: StoryboardParseFieldDef[] = []
): string {
  if (catalog.length > 0) {
    const compiled = compileShotText(catalog, row.shotFields).trim();
    if (compiled) return compiled;
  }
  const shotText = (row.shotText || '').trim();
  if (shotText) return shotText;
  return (row.shotRaw || '').trim();
}

/** 单镜分镜合成卡字段列表（re-export） */
export { storyboardShotCompositeFieldItems };

/** 多镜合成组：各镜字段带镜号前缀 */
export function storyboardGroupCompositeFieldItems(
  rows: StoryboardTableRow[],
  catalog: StoryboardParseFieldDef[] = []
): StoryboardCompositeFieldItem[] {
  return groupFieldItems(rows, catalog, storyboardRowOutlineTitle);
}
