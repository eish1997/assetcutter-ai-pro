import type { StoryboardParseFieldDef, StoryboardTableRow } from '../types';
import { createStoryboardTableRow } from './storyboardTableAsset';
import {
  applyShotFieldsPatch,
  inferRedrawInclude,
  isSystemDurationLabel,
  isSystemParseFieldLabel,
  isSystemShotNoLabel,
  mergeParseFieldsIntoCatalog,
  parseDurationSecFromParsedValue,
  parseShotNoFromParsedValue,
  purgeSystemFieldValuesFromShotFields,
  resolveFieldId,
  type StoryboardParseFieldItem,
} from './storyboardTableParse';

export type StoryboardBulkTextMode = 'pipe' | 'tsv';

export type StoryboardBulkImportRow = {
  shotNo?: string;
  durationSec?: number | null;
  shotRaw: string;
  fields: StoryboardParseFieldItem[];
};

export type StoryboardBulkParseResult = {
  headers: string[];
  rows: StoryboardBulkImportRow[];
  errors: string[];
};

const HEADER_HINT_RE = /镜头|镜号|景别|shot|duration|时长|画面|角度|运镜/i;

function isPlaceholderValue(value: string): boolean {
  const t = value.trim();
  return !t || t === '-' || t === '—' || t === '–';
}

function looksLikeHeader(cells: string[]): boolean {
  if (!cells.length) return false;
  return HEADER_HINT_RE.test(cells.join(' '));
}

export function detectStoryboardBulkDelimiter(text: string, mode: StoryboardBulkTextMode): '|' | '\t' | ',' {
  if (mode === 'tsv') return '\t';
  const firstLine = text.split(/\r?\n/).find((line) => line.trim());
  if (!firstLine) return '|';
  const pipe = (firstLine.match(/\|/g) || []).length;
  const tab = (firstLine.match(/\t/g) || []).length;
  const comma = (firstLine.match(/,/g) || []).length;
  if (tab > pipe && tab > comma) return '\t';
  if (comma > pipe && comma >= tab) return ',';
  return '|';
}

export function splitDelimitedStoryboardLine(line: string, delimiter: '|' | '\t' | ','): string[] {
  if (delimiter === '|') {
    return line.split(/\s*\|\s*/).map((cell) => cell.trim());
  }
  if (delimiter === '\t') {
    return line.split('\t').map((cell) => cell.trim());
  }
  return line.split(',').map((cell) => cell.trim());
}

function formatPipeRow(headers: string[], cells: string[]): string {
  return headers.map((header, index) => `${header} | ${cells[index] ?? ''}`).join('\n');
}

function inferFieldKind(label: string, value: string): 'text' | 'multiline' {
  if (/画面|内容|描述|动作|备注|建议|设计/.test(label) && value.length > 48) {
    return 'multiline';
  }
  return 'text';
}

function mapCellsToImportRow(headers: string[], cells: string[]): StoryboardBulkImportRow | null {
  const normalizedHeaders = headers.map((header) => header.trim()).filter(Boolean);
  if (!normalizedHeaders.length) return null;

  let shotNo: string | undefined;
  let durationSec: number | null | undefined;
  const fields: StoryboardParseFieldItem[] = [];

  for (let index = 0; index < normalizedHeaders.length; index += 1) {
    const label = normalizedHeaders[index];
    const value = String(cells[index] ?? '').trim();
    if (isPlaceholderValue(value)) continue;

    if (isSystemShotNoLabel(label)) {
      const parsed = parseShotNoFromParsedValue(value);
      if (parsed) shotNo = parsed;
      continue;
    }
    if (isSystemDurationLabel(label)) {
      durationSec = parseDurationSecFromParsedValue(value);
      continue;
    }

    fields.push({
      label,
      value,
      kind: inferFieldKind(label, value),
      redrawInclude: inferRedrawInclude(label),
    });
  }

  if (!shotNo && !fields.length && durationSec == null) return null;

  return {
    shotNo,
    durationSec: durationSec ?? null,
    shotRaw: formatPipeRow(normalizedHeaders, cells),
    fields,
  };
}

export function parseStoryboardBulkText(
  text: string,
  mode: StoryboardBulkTextMode
): StoryboardBulkParseResult {
  const errors: string[] = [];
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return { headers: [], rows: [], errors: ['请输入至少一行内容'] };
  }

  const delimiter = detectStoryboardBulkDelimiter(text, mode);
  const firstCells = splitDelimitedStoryboardLine(lines[0], delimiter);
  const hasHeader = looksLikeHeader(firstCells);
  const headers = hasHeader ? firstCells.map((cell) => cell.trim()) : [];
  const dataLines = hasHeader ? lines.slice(1) : lines;

  if (!headers.length) {
    return { headers: [], rows: [], errors: ['未识别表头，请包含「镜头号」「景别」等列名'] };
  }

  const rows: StoryboardBulkImportRow[] = [];
  for (let lineIndex = 0; lineIndex < dataLines.length; lineIndex += 1) {
    const cells = splitDelimitedStoryboardLine(dataLines[lineIndex], delimiter);
    if (!cells.some((cell) => cell.trim())) continue;
    const row = mapCellsToImportRow(headers, cells);
    if (!row) {
      errors.push(`第 ${lineIndex + (hasHeader ? 2 : 1)} 行无有效数据`);
      continue;
    }
    rows.push(row);
  }

  if (!rows.length && !errors.length) {
    errors.push('未解析到有效镜头行');
  }

  return { headers, rows, errors };
}

export function applyStoryboardBulkImport(
  catalog: StoryboardParseFieldDef[],
  existingRows: StoryboardTableRow[],
  imports: StoryboardBulkImportRow[],
  mode: 'replace' | 'append'
): { catalog: StoryboardParseFieldDef[]; rows: StoryboardTableRow[] } {
  let nextCatalog = [...catalog];
  const importedRows: StoryboardTableRow[] = [];

  for (const item of imports) {
    nextCatalog = mergeParseFieldsIntoCatalog(nextCatalog, item.fields);
    let shotFields = purgeSystemFieldValuesFromShotFields(nextCatalog, {});
    for (const field of item.fields) {
      if (isSystemParseFieldLabel(field.label)) continue;
      const id = resolveFieldId(nextCatalog, field.label.trim());
      const def = nextCatalog.find((entry) => entry.id === id);
      const kind = def?.kind === 'multiline' ? 'multiline' : 'text';
      const max = kind === 'multiline' ? 4000 : 500;
      shotFields[id] = field.value.length > max ? field.value.slice(0, max) : field.value;
    }
    shotFields = purgeSystemFieldValuesFromShotFields(nextCatalog, shotFields);

    const base = createStoryboardTableRow(
      {
        shotNo: item.shotNo ?? '',
        durationSec: item.durationSec ?? null,
        shotRaw: item.shotRaw,
        shotFields,
      },
      importedRows.length
    );
    importedRows.push(applyShotFieldsPatch(base, nextCatalog, shotFields));
  }

  const baseRows = mode === 'append' ? [...existingRows] : [];
  const rows = [...baseRows, ...importedRows].map((row, index) => ({ ...row, index }));
  return { catalog: nextCatalog, rows };
}
