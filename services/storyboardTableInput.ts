import type { StoryboardParseFieldDef, StoryboardTableRow } from '../types';
import { scopedStorageKey } from './clientPersist';
import { storyboardRowHasFrameRef } from './storyboardFrameImageUrl';
import { rowHasStructuredFieldValues, resolveStoryboardParseInput } from './storyboardTableParse';

export const STORYBOARD_BULK_DRAFT_KEY = 'ac_storyboard_bulk_draft_v1';

export type StoryboardBulkDraft = {
  mode: 'image' | 'pipe' | 'tsv';
  pipeText: string;
  tsvText: string;
  imageDataUrl?: string;
};

export function storyboardBulkDraftStorageKey(assetId: string): string {
  return scopedStorageKey(`${STORYBOARD_BULK_DRAFT_KEY}__${assetId}`, null);
}

export function defaultStoryboardBulkDraft(): StoryboardBulkDraft {
  return { mode: 'pipe', pipeText: '', tsvText: '' };
}

export type StoryboardInputCoverage = {
  total: number;
  withInput: number;
  parsed: number;
  withImage: number;
};

export type StoryboardInputPreviewLine = {
  label: string;
  value: string;
};

export function computeStoryboardInputCoverage(
  rows: StoryboardTableRow[],
  catalog: StoryboardParseFieldDef[]
): StoryboardInputCoverage {
  let withInput = 0;
  let parsed = 0;
  let withImage = 0;
  for (const row of rows) {
    if (resolveStoryboardParseInput(row, catalog).trim()) withInput += 1;
    if (rowHasStructuredFieldValues(catalog, row)) parsed += 1;
    if (storyboardRowHasFrameRef(row)) withImage += 1;
  }
  return { total: rows.length, withInput, parsed, withImage };
}

/** 解析预览区：取 catalog 内前若干非空字段 */
export function storyboardInputPreviewFieldLines(
  row: StoryboardTableRow,
  catalog: StoryboardParseFieldDef[],
  maxFields = 4
): StoryboardInputPreviewLine[] {
  return [...catalog]
    .sort((a, b) => a.order - b.order)
    .map((def) => ({
      label: def.label,
      value: String(row.shotFields[def.id] || '').trim(),
    }))
    .filter((line) => line.value.length > 0)
    .slice(0, maxFields);
}
