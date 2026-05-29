import type { StoryboardParseFieldDef, StoryboardTableRow } from '../types';
import { compileShotText } from './storyboardTableParse';

export type StoryboardCompositeFieldItem = {
  id: string;
  label: string;
  value: string;
};

function compositeBodyText(row: StoryboardTableRow, catalog: StoryboardParseFieldDef[]): string {
  if (catalog.length > 0) {
    const compiled = compileShotText(catalog, row.shotFields).trim();
    if (compiled) return compiled;
  }
  const shotText = (row.shotText || '').trim();
  if (shotText) return shotText;
  return (row.shotRaw || '').trim();
}

/** 单镜分镜合成卡字段列表 */
export function storyboardShotCompositeFieldItems(
  row: StoryboardTableRow,
  catalog: StoryboardParseFieldDef[] = []
): StoryboardCompositeFieldItem[] {
  if (catalog.length > 0) {
    return catalog
      .map((def) => ({
        id: def.id,
        label: def.label,
        value: String(row.shotFields[def.id] || '').trim(),
      }))
      .filter((x) => x.value);
  }
  const body = compositeBodyText(row, catalog).trim();
  if (!body) return [];
  return [{ id: `${row.id}-body`, label: '描述', value: body }];
}

/** 多镜合成组：各镜字段带镜号前缀 */
export function storyboardGroupCompositeFieldItems(
  rows: StoryboardTableRow[],
  catalog: StoryboardParseFieldDef[] = [],
  shotLabel: (row: StoryboardTableRow, index: number) => string
): StoryboardCompositeFieldItem[] {
  const items: StoryboardCompositeFieldItem[] = [];
  for (const row of rows) {
    const shot = shotLabel(row, row.index);
    if (catalog.length > 0) {
      for (const item of storyboardShotCompositeFieldItems(row, catalog)) {
        items.push({
          id: `${row.id}-${item.id}`,
          label: `${shot} · ${item.label}`,
          value: item.value,
        });
      }
      continue;
    }
    const body = compositeBodyText(row, catalog).trim();
    if (body) {
      items.push({ id: `${row.id}-body`, label: shot, value: body });
    }
  }
  return items;
}
