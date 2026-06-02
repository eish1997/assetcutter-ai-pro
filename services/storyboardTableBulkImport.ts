import type { StoryboardParseFieldDef, StoryboardTableRow } from '../types';
import { createStoryboardTableRow, preserveStoryboardRowFrameFields } from './storyboardTableAsset';
import { storyboardRowHasFrameRef } from './storyboardFrameImageUrl';
import { storyboardShotNosMatch } from './storyboardSheetVisionSplit';
import {
  applyShotFieldsPatch,
  inferRedrawInclude,
  isSystemDurationLabel,
  isSystemParseFieldLabel,
  isSystemShotNoLabel,
  isStoryboardShotNoValue,
  mergeParseFieldsIntoCatalog,
  normalizeStoryboardShotNoInput,
  normalizeStoryboardShotNoKey,
  parseDurationSecFromParsedValue,
  parseShotNoFromParsedValue,
  compareStoryboardShotNos,
  purgeSystemFieldValuesFromShotFields,
  resolveFieldId,
  type StoryboardParseFieldItem,
} from './storyboardTableParse';
import { ensureShotCharacterFieldOnRow, isShotCharacterFieldLabel } from './storyboardShotCharacters';

export function rowHasStoryboardBulkImportBaseline(row: StoryboardTableRow): boolean {
  if ((row.shotRaw || '').trim()) return true;
  if (Object.values(row.shotFields || {}).some((value) => String(value || '').trim())) return true;
  if (storyboardRowHasFrameRef(row)) return true;
  if (row.frameImageHistory?.length) return true;
  return false;
}

function findExistingRowIndexForImport(
  rows: StoryboardTableRow[],
  shotNo: string
): number {
  const trimmed = shotNo.trim();
  if (!trimmed) return -1;
  const shotKey = normalizeStoryboardShotNoKey(trimmed);
  const exact = rows.findIndex((row) => normalizeStoryboardShotNoKey(row.shotNo || '') === shotKey);
  if (exact >= 0) return exact;
  return rows.findIndex((row) => storyboardShotNosMatch(row.shotNo || '', trimmed));
}

function sortedUnusedFrameRows(
  rows: StoryboardTableRow[],
  usedIds: Set<string>
): StoryboardTableRow[] {
  return rows
    .filter((row) => !usedIds.has(row.id) && storyboardRowHasFrameRef(row))
    .sort((a, b) => a.index - b.index);
}

/** 镜号匹配优先；镜号缺失或不一致时按已有分镜图行顺序与导入顺序对齐 */
export function resolveFrameSourceForStoryboardImport(
  existingRows: StoryboardTableRow[],
  shotNo: string,
  _importIndex: number,
  usedFrameRowIds: Set<string>
): StoryboardTableRow | undefined {
  const trimmed = shotNo.trim();
  if (trimmed) {
    const byShot = existingRows.find(
      (row) =>
        !usedFrameRowIds.has(row.id) &&
        storyboardRowHasFrameRef(row) &&
        storyboardShotNosMatch(row.shotNo || '', trimmed)
    );
    if (byShot) {
      usedFrameRowIds.add(byShot.id);
      return byShot;
    }
  }
  const pool = sortedUnusedFrameRows(existingRows, usedFrameRowIds);
  const pick = pool[0];
  if (!pick) return undefined;
  usedFrameRowIds.add(pick.id);
  return pick;
}

function storyboardRowHasImportText(row: StoryboardTableRow): boolean {
  if ((row.shotRaw || '').trim()) return true;
  return Object.values(row.shotFields || {}).some((value) => String(value || '').trim());
}

export type StoryboardBulkTextMode = 'pipe' | 'tsv';

export type StoryboardBulkSourceLine = {
  lineNo: number;
  charStart: number;
  charEnd: number;
  text: string;
};

export type StoryboardBulkImportRow = {
  shotNo?: string;
  durationSec?: number | null;
  shotRaw: string;
  fields: StoryboardParseFieldItem[];
};

export type StoryboardBulkParseLineError = {
  lineNo: number;
  charStart: number;
  charEnd: number;
  message: string;
  preview: string;
};

export type StoryboardBulkDuplicateShotLineRef = {
  lineNo: number;
  shotNo: string;
  preview: string;
};

export type StoryboardBulkDuplicateShotGroup = {
  shotNo: string;
  lines: Array<{ lineNo: number; preview: string }>;
};

export type StoryboardBulkParseResult = {
  headers: string[];
  rows: StoryboardBulkImportRow[];
  errors: string[];
  lineErrors: StoryboardBulkParseLineError[];
  duplicateShotNos: string[];
  duplicateShotGroups: StoryboardBulkDuplicateShotGroup[];
};

/** 常见分镜列名关键词（表头识别） */
const HEADER_HINT_RE =
  /镜头|镜号|镜次|分镜|景别|shot|duration|时长|时间|帧|画面|内容|描述|角度|运镜|机位|构图|焦距|对白|台词|音效|声音|音乐|旁白|备注|动作|场景|服化|光影|特效|设计/i;

const DURATION_VALUE_RE = /^\d+(?:\.\d+)?\s*(?:[秒sS]|帧)?$/;

const SCALE_VALUE_RE = /^(?:大)?远景|全景|中景|近景|特写|大特写|微距$/;

const CAMERA_MOVE_RE = /^(?:固定|推|拉|摇|移|跟|升|降|甩|旋|环绕|手持|稳定器)/;

const META_ROW_RE =
  /第[一二三四五六七八九十\d]+幕|呼吸韵律|共\s*\d+\s*镜|统筹|场次说明|场景说明|分场表|镜头表说明/i;

const TAGGED_FIELD_RE = /【([^】]+)】/g;

const FREEFORM_SHOT_META_RE =
  /^(\d{1,3})((?:大)?(?:远景|全景|中景|近景|特写|大特写|微距))\s*(\d+(?:\.\d+)?)\s*(?:[秒sS]|帧)?/i;

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

function looksLikeDataCell(value: string): boolean {
  const t = value.trim();
  if (!t || isPlaceholderValue(t)) return false;
  if (t.length > 28) return true;
  if (isStoryboardShotNoValue(t)) return true;
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

  if (values.every((value) => isStoryboardShotNoValue(value))) return '镜头号';
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
  lines: StoryboardBulkSourceLine[],
  delimiter: '|' | '\t' | ','
): { headers: string[]; dataLines: StoryboardBulkSourceLine[]; headerInferred: boolean } {
  const scanLimit = Math.min(6, lines.length);
  for (let index = 0; index < scanLimit; index += 1) {
    const cells = splitDelimitedStoryboardLine(lines[index]!.text, delimiter).map((cell) =>
      normalizeHeaderLabel(cell)
    );
    if (!looksLikeHeader(cells)) continue;
    const nextCells =
      index + 1 < lines.length
        ? splitDelimitedStoryboardLine(lines[index + 1]!.text, delimiter)
        : [];
    if (nextCells.length && looksLikeDataRow(nextCells)) {
      return { headers: cells, dataLines: lines.slice(index + 1), headerInferred: false };
    }
    if (index === 0 && lines.length > 1) {
      return { headers: cells, dataLines: lines.slice(index + 1), headerInferred: false };
    }
  }

  const allCells = lines.map((line) => splitDelimitedStoryboardLine(line.text, delimiter));
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

export function splitStoryboardBulkSourceLines(text: string): StoryboardBulkSourceLine[] {
  const lines: StoryboardBulkSourceLine[] = [];
  let logicalNo = 0;
  let offset = 0;
  const parts = text.split(/\r?\n/);
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]!;
    const charStart = offset;
    const charEnd = offset + part.length;
    offset = charEnd + (index < parts.length - 1 ? 1 : 0);
    if (!part.trim()) continue;
    logicalNo += 1;
    lines.push({ lineNo: logicalNo, charStart, charEnd, text: part });
  }
  return lines;
}

export function resolveStoryboardBulkLineCharRange(
  text: string,
  lineNo: number
): { charStart: number; charEnd: number } | null {
  const lines = splitStoryboardBulkSourceLines(text);
  const match = lines.find((line) => line.lineNo === lineNo);
  if (!match) return null;
  return { charStart: match.charStart, charEnd: match.charEnd };
}

export function scrollTextareaToCharRange(
  textarea: HTMLTextAreaElement,
  charStart: number,
  charEnd: number
): void {
  textarea.focus();
  textarea.setSelectionRange(charStart, charEnd);
  const value = textarea.value;
  const lineStart = value.lastIndexOf('\n', charStart - 1) + 1;
  const before = value.slice(0, lineStart);
  const lineIndex = before.split('\n').length - 1;
  const style = window.getComputedStyle(textarea);
  const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.4 || 16;
  textarea.scrollTop = Math.max(0, lineIndex * lineHeight - textarea.clientHeight / 3);
}

/** 去掉误粘贴的列前缀，如「音效|131中景…」 */
export function normalizeFreeformSourceLine(raw: string): string {
  let line = raw.trim();
  const pipeIdx = line.indexOf('|');
  if (pipeIdx <= 0) return line;

  const prefix = line.slice(0, pipeIdx).trim();
  const rest = line.slice(pipeIdx + 1).trim();
  if (!rest) return line;

  const prefixLooksLikeHeader =
    isSystemDurationLabel(prefix) ||
    isSystemShotNoLabel(prefix) ||
    /^(音效|声音|音乐|画面|内容|描述|景别|运镜|机位|时长|备注)/.test(prefix);

  if (prefixLooksLikeHeader && (/\d/.test(rest) || rest.includes('【'))) {
    return rest;
  }
  return line;
}

/** 从自由文本行首提取镜号、景别、时长，如「131中景 3.5s」 */
export function extractShotMetaFromFreeformLine(text: string): {
  shotNo?: string;
  scale?: string;
  durationSec?: number | null;
  remainder: string;
} {
  const trimmed = text.trim();
  const match = trimmed.match(FREEFORM_SHOT_META_RE);
  if (!match) {
    return { remainder: trimmed };
  }

  const shotNo = match[1]!;
  const scale = match[2]!;
  const durationRaw = match[3]!;
  const durationSec = parseDurationSecFromParsedValue(`${durationRaw}s`);
  const consumed = match[0]!.length;
  const remainder = trimmed.slice(consumed).trim();

  return {
    shotNo: parseShotNoFromParsedValue(shotNo) || normalizeStoryboardShotNoInput(shotNo),
    scale,
    durationSec,
    remainder,
  };
}

/** 将【标签】映射到表字段 label */
export function mapStoryboardTagLabel(raw: string): string {
  const label = raw.trim();
  if (/^画面描述/.test(label) || /^画面内容/.test(label) || /^画面$/.test(label)) {
    return '画面描述、角色表演与3D流体特效';
  }
  if (/运镜|机位|构图|虚拟机位|切入|跟随|推拉|摇移|跟拍|环绕|升格|降格|相机|镜头运动/.test(label)) {
    return '3D虚拟机位运镜与构图描述';
  }
  if (/音效|声音|音乐/.test(label)) {
    return '音效';
  }
  if (/对白|台词/.test(label)) {
    return '台词同步';
  }
  if (/景别/.test(label)) {
    return '景别';
  }
  if (/^(镜头内角色|出镜角色|镜头角色|本镜角色)$/.test(label)) {
    return '镜头内角色';
  }
  if (/时长|时间|帧/.test(label)) {
    return '时长';
  }
  if (/阴影|轴线|广角|拉升|微距|淡出|延时|分流|飞跃|平移|形变|大片|高潮|跟拍|交接|反应|特写|形变|长镜|后拉/.test(label)) {
    return '3D虚拟机位运镜与构图描述';
  }
  return '画面描述、角色表演与3D流体特效';
}

/** 解析行内【标签】段落 */
export function parseTaggedStoryboardFields(text: string): StoryboardParseFieldItem[] {
  const fields: StoryboardParseFieldItem[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(TAGGED_FIELD_RE.source, TAGGED_FIELD_RE.flags);
  const indices: Array<{ label: string; valueStart: number; tagEnd: number }> = [];

  while ((match = re.exec(text)) !== null) {
    indices.push({
      label: match[1]!.trim(),
      valueStart: match.index + match[0].length,
      tagEnd: match.index + match[0].length,
    });
  }

  for (let index = 0; index < indices.length; index += 1) {
    const current = indices[index]!;
    const nextTagIndex = index + 1 < indices.length ? text.indexOf('【', current.valueStart) : text.length;
    const valueEnd = nextTagIndex >= current.valueStart ? nextTagIndex : text.length;
    const value = text.slice(current.valueStart, valueEnd).replace(/^[。，、；;:\s]+/, '').trim();
    if (!value) continue;

    const mappedLabel = mapStoryboardTagLabel(current.label);
    let fieldValue = value;
    if (
      mappedLabel !== current.label &&
      mappedLabel === '3D虚拟机位运镜与构图描述'
    ) {
      fieldValue = value ? `【${current.label}】${value}` : `【${current.label}】`;
    }

    const existingField = fields.find((field) => field.label === mappedLabel);
    if (existingField) {
      existingField.value = `${existingField.value}\n${fieldValue}`.trim();
      existingField.kind = inferFieldKind(mappedLabel, existingField.value);
      continue;
    }

    fields.push({
      label: mappedLabel,
      value: fieldValue,
      kind: inferFieldKind(mappedLabel, fieldValue),
      redrawInclude: inferRedrawInclude(mappedLabel),
    });
  }

  return fields;
}

function resolveImportFieldLabel(
  catalog: StoryboardParseFieldDef[],
  rawLabel: string
): string | null {
  const labels = catalog
    .filter((field) => !isSystemParseFieldLabel(field.label))
    .map((field) => field.label.trim());
  const trimmed = rawLabel.trim();
  if (!trimmed || !labels.length) return null;
  if (labels.includes(trimmed)) return trimmed;

  const mapped = mapStoryboardTagLabel(trimmed);
  if (labels.includes(mapped)) return mapped;

  if (/台词|对白/.test(trimmed) && labels.includes('台词同步')) return '台词同步';
  if (/运镜|机位|构图|虚拟机位/.test(trimmed) && labels.includes('3D虚拟机位运镜与构图描述')) {
    return '3D虚拟机位运镜与构图描述';
  }
  if (/画面/.test(trimmed) && labels.includes('画面描述、角色表演与3D流体特效')) {
    return '画面描述、角色表演与3D流体特效';
  }
  if (/音效|声音|音乐/.test(trimmed) && labels.includes('音效')) return '音效';
  if (/景别/.test(trimmed) && labels.includes('景别')) return '景别';
  if (isShotCharacterFieldLabel(trimmed) && labels.includes('镜头内角色')) return '镜头内角色';

  if (labels.includes('3D虚拟机位运镜与构图描述') && mapped === '3D虚拟机位运镜与构图描述') {
    return mapped;
  }
  if (labels.includes('画面描述、角色表演与3D流体特效') && mapped === '画面描述、角色表演与3D流体特效') {
    return mapped;
  }
  return null;
}

/** 合并导入时只写入表内已有字段，同类内容合并到同一列 */
export function alignImportFieldsToCatalog(
  catalog: StoryboardParseFieldDef[],
  fields: StoryboardParseFieldItem[]
): StoryboardParseFieldItem[] {
  const merged = new Map<string, StoryboardParseFieldItem>();
  for (const field of fields) {
    const label = resolveImportFieldLabel(catalog, field.label);
    if (!label) continue;
    const existing = merged.get(label);
    if (existing) {
      existing.value = `${existing.value}\n${field.value}`.trim();
      existing.kind = inferFieldKind(label, existing.value);
    } else {
      merged.set(label, {
        ...field,
        label,
        kind: inferFieldKind(label, field.value),
        redrawInclude: inferRedrawInclude(label, field.redrawInclude),
      });
    }
  }
  return [...merged.values()];
}

function inferFieldKind(label: string, value: string): 'text' | 'multiline' {
  if (/画面|内容|描述|动作|备注|建议|设计/.test(label) && value.length > 48) {
    return 'multiline';
  }
  return 'text';
}

function hasTaggedFields(text: string): boolean {
  TAGGED_FIELD_RE.lastIndex = 0;
  return TAGGED_FIELD_RE.test(text);
}

function hasShotColumn(headers: string[]): boolean {
  return headers.some((header) => isSystemShotNoLabel(normalizeHeaderLabel(header)));
}

function isRepeatedHeaderRow(cells: string[], headers: string[]): boolean {
  if (looksLikeDataRow(cells)) return false;
  const normalized = cells.map((cell) => normalizeHeaderLabel(cell)).filter(Boolean);
  if (normalized.length < 2) return false;
  if (normalized.some((cell) => isStoryboardShotNoValue(cell))) return false;

  const knownHeaders = new Set(headers.map((header) => normalizeHeaderLabel(header)));
  const headerLikeCount = normalized.filter(
    (cell) =>
      knownHeaders.has(cell) ||
      isSystemShotNoLabel(cell) ||
      (cell.length <= 18 && HEADER_HINT_RE.test(cell) && !looksLikeDataCell(cell))
  ).length;
  return headerLikeCount >= Math.ceil(normalized.length * 0.6);
}

function isMetaStoryboardRow(cells: string[], headers: string[]): boolean {
  const joined = cells.join(' ').trim();
  if (!joined || cells.every((cell) => isPlaceholderValue(cell))) return true;
  if (isRepeatedHeaderRow(cells, headers)) return true;
  if (META_ROW_RE.test(joined)) return true;

  const shotIndex = headers.findIndex((header) => isSystemShotNoLabel(normalizeHeaderLabel(header)));
  if (shotIndex >= 0) {
    const shotCell = String(cells[shotIndex] ?? '').trim();
    if (shotCell && !isStoryboardShotNoValue(shotCell) && META_ROW_RE.test(shotCell)) {
      return true;
    }
    if (shotCell.length > 20 && !isStoryboardShotNoValue(shotCell) && /幕|韵律|共.*镜/.test(shotCell)) {
      return true;
    }
  }
  return false;
}

function mapCellsToImportRow(
  headers: string[],
  cells: string[],
  sourceText: string
): StoryboardBulkImportRow | null {
  const normalizedHeaders = headers.map((header) => normalizeHeaderLabel(header)).filter(Boolean);
  if (!normalizedHeaders.length) return null;

  const normalizedSource = normalizeFreeformSourceLine(sourceText);
  const taggedFields = parseTaggedStoryboardFields(normalizedSource);
  const freeformMeta = extractShotMetaFromFreeformLine(normalizedSource);

  let shotNo: string | undefined;
  let durationSec: number | null | undefined;
  const fields: StoryboardParseFieldItem[] = [];

  for (let index = 0; index < normalizedHeaders.length; index += 1) {
    const label = normalizedHeaders[index]!;
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

    // 行内已有【标签】时，结构化标签负责字段内容，跳过同列整段原文避免重复写入
    if (hasTaggedFields(normalizedSource) && hasTaggedFields(value)) {
      continue;
    }

    fields.push({
      label,
      value,
      kind: inferFieldKind(label, value),
      redrawInclude: inferRedrawInclude(label),
    });
  }

  const preferTagged = taggedFields.length > 0 || fields.length <= 1;
  if (preferTagged) {
    if (freeformMeta.shotNo) shotNo = freeformMeta.shotNo;
    if (freeformMeta.durationSec != null) durationSec = freeformMeta.durationSec;

    const mergedFields = [...fields];
    for (const tagged of taggedFields) {
      const existing = mergedFields.find((field) => field.label === tagged.label);
      if (existing) {
        existing.value = tagged.value;
        existing.kind = tagged.kind;
      } else {
        mergedFields.push(tagged);
      }
    }

    if (freeformMeta.scale) {
      const scaleLabel = '景别';
      const existingScale = mergedFields.find((field) => field.label === scaleLabel);
      if (existingScale) {
        existingScale.value = freeformMeta.scale;
      } else {
        mergedFields.push({
          label: scaleLabel,
          value: freeformMeta.scale,
          kind: 'text',
          redrawInclude: inferRedrawInclude(scaleLabel),
        });
      }
    }

    if (!shotNo && !mergedFields.length && durationSec == null) return null;

    return {
      shotNo,
      durationSec: durationSec ?? null,
      shotRaw: sourceText.trim(),
      fields: mergedFields,
    };
  }

  if (!shotNo && !fields.length && durationSec == null) return null;

  return {
    shotNo,
    durationSec: durationSec ?? null,
    shotRaw: sourceText.trim(),
    fields,
  };
}

function buildLinePreview(text: string, limit = 48): string {
  const trimmed = text.trim();
  return trimmed.length > limit ? `${trimmed.slice(0, limit)}…` : trimmed;
}

export function buildDuplicateStoryboardShotGroups(
  refs: StoryboardBulkDuplicateShotLineRef[]
): StoryboardBulkDuplicateShotGroup[] {
  const groups = new Map<string, StoryboardBulkDuplicateShotGroup>();
  for (const ref of refs) {
    const trimmed = ref.shotNo.trim();
    if (!trimmed) continue;
    const key = normalizeStoryboardShotNoKey(trimmed) || trimmed.toLowerCase();
    const existing = groups.get(key);
    const line = { lineNo: ref.lineNo, preview: ref.preview };
    if (existing) {
      existing.lines.push(line);
    } else {
      groups.set(key, { shotNo: trimmed, lines: [line] });
    }
  }
  return [...groups.values()].filter((group) => group.lines.length > 1);
}

export function findStoryboardShotCollisionLines(
  existing: Array<{ shotNo?: string }>,
  refs: StoryboardBulkDuplicateShotLineRef[]
): StoryboardBulkDuplicateShotLineRef[] {
  const existingKeys = new Set(
    existing
      .map((row) => normalizeStoryboardShotNoKey(row.shotNo || ''))
      .filter(Boolean)
  );
  return refs.filter((ref) => {
    const key = normalizeStoryboardShotNoKey(ref.shotNo);
    return key && existingKeys.has(key);
  });
}

export function parseStoryboardBulkText(
  text: string,
  mode: StoryboardBulkTextMode
): StoryboardBulkParseResult {
  const errors: string[] = [];
  const lineErrors: StoryboardBulkParseLineError[] = [];
  const sourceLines = splitStoryboardBulkSourceLines(text);

  if (!sourceLines.length) {
    return {
      headers: [],
      rows: [],
      errors: ['请输入至少一行内容'],
      lineErrors: [],
      duplicateShotNos: [],
      duplicateShotGroups: [],
    };
  }

  const delimiter = detectStoryboardBulkDelimiter(text, mode);
  const { headers, dataLines, headerInferred } = resolveHeaderAndDataLines(sourceLines, delimiter);

  if (!headers.length) {
    return {
      headers: [],
      rows: [],
      errors: ['未解析到有效列，请检查分隔符或内容格式'],
      lineErrors: [],
      duplicateShotNos: [],
      duplicateShotGroups: [],
    };
  }

  const shotColumnRequired = hasShotColumn(headers);
  const rows: StoryboardBulkImportRow[] = [];
  const duplicateRefs: StoryboardBulkDuplicateShotLineRef[] = [];

  for (const sourceLine of dataLines) {
    const cells = splitDelimitedStoryboardLine(sourceLine.text, delimiter);
    if (!cells.some((cell) => cell.trim())) continue;

    if (isMetaStoryboardRow(cells, headers)) continue;

    const row = mapCellsToImportRow(headers, cells, sourceLine.text);
    if (!row) {
      const message = '无有效数据';
      errors.push(`第 ${sourceLine.lineNo} 行${message}`);
      lineErrors.push({
        lineNo: sourceLine.lineNo,
        charStart: sourceLine.charStart,
        charEnd: sourceLine.charEnd,
        message,
        preview: buildLinePreview(sourceLine.text),
      });
      continue;
    }

    if (shotColumnRequired) {
      const shotIndex = headers.findIndex((header) => isSystemShotNoLabel(normalizeHeaderLabel(header)));
      const shotCell = shotIndex >= 0 ? String(cells[shotIndex] ?? '').trim() : '';
      const effectiveShotNo = row.shotNo || parseShotNoFromParsedValue(shotCell);
      if (!effectiveShotNo) {
        const message = '缺少有效镜号';
        errors.push(`第 ${sourceLine.lineNo} 行${message}：${buildLinePreview(sourceLine.text)}`);
        lineErrors.push({
          lineNo: sourceLine.lineNo,
          charStart: sourceLine.charStart,
          charEnd: sourceLine.charEnd,
          message,
          preview: buildLinePreview(sourceLine.text),
        });
        continue;
      }
      row.shotNo = effectiveShotNo;
    }

    rows.push(row);
    if (row.shotNo) {
      duplicateRefs.push({
        lineNo: sourceLine.lineNo,
        shotNo: row.shotNo,
        preview: buildLinePreview(sourceLine.text),
      });
    }
  }

  if (!rows.length && !errors.length) {
    errors.push('未解析到有效镜头行');
  }

  const duplicateShotGroups = buildDuplicateStoryboardShotGroups(duplicateRefs);
  const duplicateShotNos = duplicateShotGroups.map((group) => group.shotNo);

  return {
    headers,
    rows,
    errors,
    lineErrors,
    duplicateShotNos,
    duplicateShotGroups,
  };
}

function clampFieldValue(value: string, kind: 'text' | 'multiline'): string {
  const max = kind === 'multiline' ? 4000 : 500;
  return value.length > max ? value.slice(0, max) : value;
}

function buildShotFieldsFromImport(
  catalog: StoryboardParseFieldDef[],
  fields: StoryboardParseFieldItem[],
  baseFields: Record<string, string> = {}
): Record<string, string> {
  let shotFields = purgeSystemFieldValuesFromShotFields(catalog, { ...baseFields });
  for (const field of fields) {
    if (isSystemParseFieldLabel(field.label)) continue;
    const id = resolveFieldId(catalog, field.label.trim());
    const def = catalog.find((entry) => entry.id === id);
    const kind = def?.kind === 'multiline' ? 'multiline' : 'text';
    shotFields[id] = clampFieldValue(field.value, kind);
  }
  return purgeSystemFieldValuesFromShotFields(catalog, shotFields);
}

function importRowToTableRow(
  item: StoryboardBulkImportRow,
  catalog: StoryboardParseFieldDef[],
  index: number,
  baseFields?: Record<string, string>,
  options?: { preserveCatalog?: boolean }
): { catalog: StoryboardParseFieldDef[]; row: StoryboardTableRow } {
  const preserveCatalog = Boolean(options?.preserveCatalog && catalog.length);
  const fields = preserveCatalog ? alignImportFieldsToCatalog(catalog, item.fields) : item.fields;
  let nextCatalog = preserveCatalog ? catalog : mergeParseFieldsIntoCatalog(catalog, fields);
  const shotFields = buildShotFieldsFromImport(nextCatalog, fields, baseFields);

  const base = createStoryboardTableRow(
    {
      shotNo: item.shotNo ?? '',
      durationSec: item.durationSec ?? null,
      shotRaw: item.shotRaw,
      shotFields,
    },
    index
  );
  const patched = applyShotFieldsPatch(base, nextCatalog, shotFields);
  const ensured = ensureShotCharacterFieldOnRow(nextCatalog, patched, item.fields);
  const addedShotCharacterColumn =
    !catalog.some((def) => isShotCharacterFieldLabel(def.label)) &&
    ensured.catalog.some((def) => isShotCharacterFieldLabel(def.label));
  if (preserveCatalog && !addedShotCharacterColumn) {
    return { catalog: nextCatalog, row: ensured.row };
  }
  return ensured;
}

export function applyStoryboardBulkImport(
  catalog: StoryboardParseFieldDef[],
  existingRows: StoryboardTableRow[],
  imports: StoryboardBulkImportRow[],
  mode: 'replace' | 'append'
): { catalog: StoryboardParseFieldDef[]; rows: StoryboardTableRow[]; touchedRowIds: string[] } {
  let nextCatalog = [...catalog];
  const touchedRowIds: string[] = [];

  if (mode === 'replace') {
    const importedRows: StoryboardTableRow[] = [];
    const usedFrameRowIds = new Set<string>();
    for (let importIndex = 0; importIndex < imports.length; importIndex += 1) {
      const item = imports[importIndex]!;
      const result = importRowToTableRow(item, nextCatalog, importedRows.length);
      nextCatalog = result.catalog;
      const frameSource = resolveFrameSourceForStoryboardImport(
        existingRows,
        item.shotNo || '',
        importIndex,
        usedFrameRowIds
      );
      importedRows.push({
        ...result.row,
        ...(frameSource ? preserveStoryboardRowFrameFields(frameSource) : {}),
      });
      touchedRowIds.push(result.row.id);
    }
    const rows = importedRows.map((row, index) => ({ ...row, index }));
    return { catalog: nextCatalog, rows, touchedRowIds };
  }

  const rowByShotKey = new Map<string, StoryboardTableRow>();
  for (const row of existingRows) {
    const key = normalizeStoryboardShotNoKey(row.shotNo || '');
    if (key) rowByShotKey.set(key, row);
  }

  const mergedRows: StoryboardTableRow[] = existingRows.map((row) => ({ ...row }));

  const findRowIndexByShotKey = (shotNo: string) => findExistingRowIndexForImport(mergedRows, shotNo);

  const findInsertIndexByShotNo = (shotNo: string) => {
    const trimmed = shotNo.trim();
    if (!trimmed) return mergedRows.length;
    for (let i = 0; i < mergedRows.length; i += 1) {
      if (compareStoryboardShotNos(trimmed, mergedRows[i]?.shotNo || '') < 0) return i;
    }
    return mergedRows.length;
  };

  const preserveCatalog = catalog.length > 0;
  const usedFrameRowIds = new Set<string>();

  for (let importIndex = 0; importIndex < imports.length; importIndex += 1) {
    const item = imports[importIndex]!;
    const shotKey = normalizeStoryboardShotNoKey(item.shotNo || '');
    const existingIndex = item.shotNo ? findRowIndexByShotKey(item.shotNo) : -1;
    const existing = existingIndex >= 0 ? mergedRows[existingIndex] : undefined;

    if (existing) {
      if (storyboardRowHasFrameRef(existing)) {
        usedFrameRowIds.add(existing.id);
      }
      const result = importRowToTableRow(
        item,
        nextCatalog,
        existing.index,
        existing.shotFields || {},
        { preserveCatalog }
      );
      nextCatalog = result.catalog;
      const updated: StoryboardTableRow = {
        ...existing,
        ...result.row,
        id: existing.id,
        ...preserveStoryboardRowFrameFields(existing),
        shotFields: result.row.shotFields,
        shotRaw: item.shotRaw || result.row.shotRaw,
        shotNo: normalizeStoryboardShotNoInput(item.shotNo || existing.shotNo || ''),
        durationSec: item.durationSec ?? existing.durationSec,
      };
      mergedRows[existingIndex] = updated;
      rowByShotKey.set(shotKey, updated);
      touchedRowIds.push(existing.id);
      continue;
    }

    const insertAt = findInsertIndexByShotNo(item.shotNo || '');
    const frameSource = resolveFrameSourceForStoryboardImport(
      mergedRows,
      item.shotNo || '',
      importIndex,
      usedFrameRowIds
    );
    const frameRowIndex =
      frameSource && !storyboardRowHasImportText(frameSource)
        ? mergedRows.findIndex((row) => row.id === frameSource.id)
        : -1;

    if (frameRowIndex >= 0) {
      const frameRow = mergedRows[frameRowIndex]!;
      const result = importRowToTableRow(
        item,
        nextCatalog,
        frameRow.index,
        frameRow.shotFields || {},
        { preserveCatalog }
      );
      nextCatalog = result.catalog;
      const updated: StoryboardTableRow = {
        ...frameRow,
        ...result.row,
        id: frameRow.id,
        ...preserveStoryboardRowFrameFields(frameRow),
        shotFields: result.row.shotFields,
        shotRaw: item.shotRaw || result.row.shotRaw,
        shotNo: normalizeStoryboardShotNoInput(item.shotNo || frameRow.shotNo || ''),
        durationSec: item.durationSec ?? frameRow.durationSec,
      };
      mergedRows[frameRowIndex] = updated;
      if (shotKey) rowByShotKey.set(shotKey, updated);
      touchedRowIds.push(frameRow.id);
      continue;
    }

    const result = importRowToTableRow(item, nextCatalog, insertAt, undefined, { preserveCatalog });
    nextCatalog = result.catalog;
    const inserted: StoryboardTableRow = {
      ...result.row,
      ...(frameSource ? preserveStoryboardRowFrameFields(frameSource) : {}),
    };
    mergedRows.splice(insertAt, 0, inserted);
    if (shotKey) rowByShotKey.set(shotKey, inserted);
    touchedRowIds.push(inserted.id);
  }

  const rows = mergedRows.map((row, index) => ({ ...row, index }));

  return { catalog: nextCatalog, rows, touchedRowIds };
}
