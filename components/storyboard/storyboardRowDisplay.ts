import type { StoryboardParseFieldDef, StoryboardTableRow } from '../../types';
import { compileShotText, pickPrimaryVisualField } from '../../services/storyboardTableParse';

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

export type StoryboardCompositeFieldItem = {
  id: string;
  label: string;
  value: string;
};

/** 多镜合成组：各镜字段带镜号前缀 */
export function storyboardGroupCompositeFieldItems(
  rows: StoryboardTableRow[],
  catalog: StoryboardParseFieldDef[] = []
): StoryboardCompositeFieldItem[] {
  const items: StoryboardCompositeFieldItem[] = [];
  for (const row of rows) {
    const shot = storyboardRowOutlineTitle(row, row.index);
    if (catalog.length > 0) {
      for (const def of catalog) {
        const value = String(row.shotFields[def.id] || '').trim();
        if (!value) continue;
        items.push({
          id: `${row.id}-${def.id}`,
          label: `${shot} · ${def.label}`,
          value,
        });
      }
      continue;
    }
    const body = storyboardRowCompositeBodyText(row, catalog).trim();
    if (body) {
      items.push({ id: `${row.id}-body`, label: shot, value: body });
    }
  }
  return items;
}
