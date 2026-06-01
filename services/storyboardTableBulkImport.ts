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
import { ensureShotCharacterFieldOnRow } from './storyboardShotCharacters';

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

/** 常见分镜列名关键词（表头识别） */
const HEADER_HINT_RE =
  /镜头|镜号|镜次|分镜|景别|shot|duration|时长|时间|帧|画面|内容|描述|角度|运镜|机位|构图|焦距|对白|台词|音效|声音|音乐|旁白|备注|动作|场景|服化|光影|特效|设计/i;

const SHOT_NO_VALUE_RE =
  /^(?:SC|S)\d+(?:[_-]SH?\d+)?$|^[A-Z]\d+(?:[_-]\d+)?$|^[A-Z]-?\d{1,3}$|^\d{1,3}$/i;

const DURATION_VALUE_RE = /^\d+(?:\.\d+)?\s*(?:[秒sS]|帧)?$/;

const SCALE_VALUE_RE = /^(?:大)?远景|全景|中景|近景|特写|大特写|微距$/;

const CAMERA_MOVE_RE = /^(?:固定|推|拉|摇|移|跟|升|降|甩|旋|环绕|手持|稳定器)/;

function isPlaceholderValue(value: string): boolean {
  const t = value.trim();
  return !t || t === '-' || t === '—' || t === '–';
}

function normalizeHeaderLabel(raw: string): string {
  return raw
    .trim()
    .replace(/^[【\[]|[】\]]$/g, '')
    .replace(/\s*[：:]\s*$/, '')
    .trim();
}

function looksLikeDurationValue(value: string): boolean {
  const t = value.trim();
  return DURATION_VALUE_RE.test(t) || /^\d+\s*帧$/.test(t);
}

function looksLikeShotNoValue(value: string): boolean {
  const t = value.trim();
  if (!t || t.length > 32) return false;
  if (SHOT_NO_VALUE_RE.test(t)) return true;
  if (/^SC\d+_SH\d+$/i.test(t)) return true;
  return false;
}

function looksLikeDataCell(value: string): boolean {
  const t = value.trim();
  if (!t || isPlaceholderValue(t)) return false;
  if (t.length > 28) return true;
  if (looksLikeShotNoValue(t)) return true;
  if (looksLikeDurationValue(t)) return true;
  if (/-?\d+\s*dB/i.test(t)) return true;
  if (SCALE_VALUE_RE.test(t)) return true;
  if (CAMERA_MOVE_RE.test(t)) return true;
  if (/^SC\d+/i.test(t)) return true;
  return false;
}

function looksLikeDataRow(cells: string[]): boolean {
  const nonEmpty = cells.map((cell) => cell.trim()).filter((cell) => cell && !isPlaceholderValue(cell));
  if (!nonEmpty.length) return false;
  const dataCells = nonEmpty.filter((cell) => looksLikeDataCell(cell));
  if (dataCells.length >= Math.max(1, Math.ceil(nonEmpty.length * 0.5))) return true;
  if (nonEmpty.some((cell) => cell.length > 36)) return true;
  return false;
}

function looksLikeHeader(cells: string[]): boolean {
  if (!cells.length) return false;
  const normalized = cells.map((cell) => normalizeHeaderLabel(cell)).filter(Boolean);
  if (!normalized.length) return false;
  if (looksLikeDataRow(normalized)) return false;
  if (HEADER_HINT_RE.test(normalized.join(' '))) return true;
  const shortLabels = normalized.filter((cell) => cell.length <= 14);
  if (shortLabels.length === normalized.length && normalized.length >= 2) return true;
  return false;
}

function inferColumnLabelFromSamples(samples: string[]): string {
  const values = samples.map((value) => value.trim()).filter((value) => value && !isPlaceholderValue(value));
  if (!values.length) return '';

  if (values.every((value) => looksLikeShotNoValue(value))) return '镜头号';
  if (values.every((value) => looksLikeDurationValue(value))) return '时长';
  if (values.some((value) => /-?\d+\s*dB|Hz|低频|高频|嗡鸣|环境音|音效|音乐|旁白|对白|台词/.test(value))) {
    return '音效';
  }
  if (values.some((value) => SCALE_VALUE_RE.test(value))) return '景别';
  if (values.some((value) => /平视|俯视|仰视|侧视|鸟瞰|低角|高角|角度/.test(value))) return '角度';
  if (values.some((value) => CAMERA_MOVE_RE.test(value) || /运镜|摇镜|推轨/.test(value))) return '运镜';
  if (values.some((value) => value.length > 40)) return '画面内容';
  if (values.some((value) => /光影|灯光|照明|色调|氛围/.test(value))) return '光影设计';
  if (values.some((value) => /服化|服装|化妆|道具|造型/.test(value))) return '服化道建议';
  if (values.some((value) => /备注|说明|注释/.test(value))) return '备注';
  return '';
}

function inferHeadersFromDataRows(rows: string[][]): string[] {
  const colCount = Math.max(1, ...rows.map((cells) => cells.length));
  const headers: string[] = [];
  for (let index = 0; index < colCount; index += 1) {
    const samples = rows.map((cells) => cells[index] ?? '').filter(Boolean);
    headers.push(inferColumnLabelFromSamples(samples) || `字段${index + 1}`);
  }
  return headers;
}

function resolveHeaderAndDataLines(
  lines: string[],
  delimiter: '|' | '\t' | ','
): { headers: string[]; dataLines: string[]; headerInferred: boolean } {
  const scanLimit = Math.min(6, lines.length);
  for (let index = 0; index < scanLimit; index += 1) {
    const cells = splitDelimitedStoryboardLine(lines[index], delimiter).map((cell) =>
      normalizeHeaderLabel(cell)
    );
    if (!looksLikeHeader(cells)) continue;
    const nextCells =
      index + 1 < lines.length
        ? splitDelimitedStoryboardLine(lines[index + 1], delimiter)
        : [];
    if (nextCells.length && looksLikeDataRow(nextCells)) {
      return { headers: cells, dataLines: lines.slice(index + 1), headerInferred: false };
    }
    if (index === 0 && lines.length > 1) {
      return { headers: cells, dataLines: lines.slice(index + 1), headerInferred: false };
    }
  }

  const allCells = lines.map((line) => splitDelimitedStoryboardLine(line, delimiter));
  const nonEmptyRows = allCells.filter((cells) => cells.some((cell) => cell.trim()));
  if (!nonEmptyRows.length) {
    return { headers: [], dataLines: [], headerInferred: true };
  }
  return {
    headers: inferHeadersFromDataRows(nonEmptyRows),
    dataLines: lines,
    headerInferred: true,
  };
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
  const normalizedHeaders = headers.map((header) => normalizeHeaderLabel(header)).filter(Boolean);
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
  const { headers, dataLines, headerInferred } = resolveHeaderAndDataLines(lines, delimiter);

  if (!headers.length) {
    return { headers: [], rows: [], errors: ['未解析到有效列，请检查分隔符或内容格式'] };
  }

  const rows: StoryboardBulkImportRow[] = [];
  for (let lineIndex = 0; lineIndex < dataLines.length; lineIndex += 1) {
    const cells = splitDelimitedStoryboardLine(dataLines[lineIndex], delimiter);
    if (!cells.some((cell) => cell.trim())) continue;
    const row = mapCellsToImportRow(headers, cells);
    if (!row) {
      errors.push(`第 ${lineIndex + (headerInferred ? 1 : 2)} 行无有效数据`);
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
    const patched = applyShotFieldsPatch(base, nextCatalog, shotFields);
    const ensured = ensureShotCharacterFieldOnRow(nextCatalog, patched, item.fields);
    nextCatalog = ensured.catalog;
    importedRows.push(ensured.row);
  }

  const baseRows = mode === 'append' ? [...existingRows] : [];
  const rows = [...baseRows, ...importedRows].map((row, index) => ({ ...row, index }));
  return { catalog: nextCatalog, rows };
}
