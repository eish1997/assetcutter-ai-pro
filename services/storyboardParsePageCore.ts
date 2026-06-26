import type { StoryboardParseFieldItem } from './storyboardTableParse';
import {
  DEFAULT_STORYBOARD_BULK_PARSE_INSTRUCTION,
  formatStoryboardNumericShotNo,
  isSystemDurationLabel,
  isSystemShotNoLabel,
  parseDurationSecFromParsedValue,
  parseShotNoFromParsedValue,
  parseStoryboardBulkStructuredWithPreset,
  STORYBOARD_BULK_PARSE_MAX_CHARS,
  type StoryboardBulkParseModelOutput,
  type StoryboardBulkParseModelRow,
} from './storyboardTableParse';
import { normalizeStoryboardBulkWithAi } from './storyboardTableBulkAiDetect';
import type { CapabilityExecuteContext } from './capabilityExecutor';
import type { CustomAppModule } from '../types';
import {
  parseStoryboardBulkText,
  parseTaggedStoryboardFields,
  buildImportRowFromFreeformShotBlock,
  extractShotMetaFromFreeformLine,
  normalizeFreeformSourceLine,
  type StoryboardBulkImportRow,
} from './storyboardTableBulkImport';

/** 解析页固定字段（展示顺序，与标准管道表头一致） */
export const STORYBOARD_PARSE_PAGE_FIXED_LABELS = [
  '镜头号',
  '时长',
  '景别',
  '焦距',
  '画面',
  '运镜',
  '对白',
  '备注',
] as const;

export const STORYBOARD_PARSE_PAGE_CANONICAL_HEADER = STORYBOARD_PARSE_PAGE_FIXED_LABELS.join(' | ');

/** 格式转换偏速度：无 preset 绑定时用 2.5 Flash（比 3 Flash Preview 更轻） */
export const STORYBOARD_PARSE_PAGE_FORMAT_MODEL_ID = 'gemini-2.5-flash';

export type StoryboardParsePageFixedLabel = (typeof STORYBOARD_PARSE_PAGE_FIXED_LABELS)[number];

export const STORYBOARD_PARSE_PAGE_NO_SHOT_HINT = '请输入带镜头号的分镜文本';

const CANONICAL_DELIMITER = ' | ';

const META_ROW_RE =
  /第[一二三四五六七八九十\d]+幕|呼吸韵律|共\s*\d+\s*镜|统筹|场次说明|场景说明|分场表|镜头表说明/i;

const DURATION_TOKEN_RE = /^\d+(?:\.\d+)?\s*(?:[秒sS]|帧)$|^\d+\.\d+$/;

const FIXED_LABEL_ALIASES: Record<StoryboardParsePageFixedLabel, RegExp[]> = {
  镜头号: [/^(镜头号|镜号|镜次|分镜号?|序号|编号|shot\s*(?:no|number|id)?)$/i],
  时长: [/^(时长|持续时间|时间|长度|帧数?|frames?|duration|dur\.?)$/i],
  景别: [/^(景别|景|scale|shot\s*size)$/i],
  焦距: [/^(焦距|焦段|focal|lens)$/i],
  画面: [/^(画面|画面内容|镜头内容|视觉|内容|描述|prompt)$/i],
  运镜: [/^(运镜|机位|角度|构图|相机|镜头运动|camera)$/i],
  对白: [/^(对白|台词|dialogue|台词同步)$/i],
  备注: [/^(备注|说明|注释|音效|声音|音乐|拟音)$/i],
};

const PARSE_PAGE_DYNAMIC_LABEL_SHORTCUTS: Array<[RegExp, string]> = [
  [/^(镜头内角色|出镜角色|本镜角色|出场角色)/, '角色'],
];

const PARSE_PAGE_MAX_DYNAMIC_LABEL_LEN = 4;

export type StoryboardShotTextBlock = {
  shotNo: string;
  lineStart: number;
  lineEnd: number;
  text: string;
};

export type StoryboardParsePageFieldParseResult = {
  ok: true;
  shotBlocks: StoryboardShotTextBlock[];
  fixedLabels: StoryboardParsePageFixedLabel[];
  dynamicLabels: string[];
  /** 扩展字段短标签 → 原文案（用于 hover 提示） */
  dynamicLabelHints: Record<string, string>;
  detectedFixedLabels: StoryboardParsePageFixedLabel[];
  importRows: StoryboardBulkImportRow[];
};

export type StoryboardParsePageFieldParseFailure = {
  ok: false;
  message: string;
};

export type StoryboardParsePageFieldParseOutcome =
  | StoryboardParsePageFieldParseResult
  | StoryboardParsePageFieldParseFailure;

function normalizeHeaderToken(raw: string): string {
  return raw
    .trim()
    .replace(/^[【\[]|[】\]]$/g, '')
    .replace(/\s*[：:]\s*$/, '')
    .trim();
}

export function mapHeaderLabelToFixedField(label: string): StoryboardParsePageFixedLabel | null {
  const normalized = normalizeHeaderToken(label);
  if (!normalized) return null;

  if (/画面描述|画面内容|角色表演|3D流体|流体特效/.test(normalized)) return '画面';
  if (/^3D虚拟|运镜与构图|虚拟机位/.test(normalized) || /运镜.*构图/.test(normalized)) {
    return '运镜';
  }

  for (const fixed of STORYBOARD_PARSE_PAGE_FIXED_LABELS) {
    if (fixed === '镜头号' || fixed === '时长') continue;
    if (FIXED_LABEL_ALIASES[fixed].some((re) => re.test(normalized))) return fixed;
  }
  if (isSystemShotNoLabel(normalized)) return '镜头号';
  if (isSystemDurationLabel(normalized)) return '时长';
  return null;
}

/** 扩展字段短标签（固定字段应走 mapHeaderLabelToFixedField） */
export function compactParsePageDynamicLabel(raw: string): string {
  const normalized = normalizeHeaderToken(raw)
    .replace(/[（(][^）)]*[）)]/g, '')
    .trim();
  if (!normalized) return '';

  for (const [pattern, short] of PARSE_PAGE_DYNAMIC_LABEL_SHORTCUTS) {
    if (pattern.test(normalized)) return short;
  }

  const segment = normalized.split(/[、,，/|]/)[0]?.trim() ?? normalized;
  if (segment.length <= PARSE_PAGE_MAX_DYNAMIC_LABEL_LEN) return segment;
  return segment.slice(0, PARSE_PAGE_MAX_DYNAMIC_LABEL_LEN);
}

/** 表格无表头时自动生成的占位列名（字段1、字段2…） */
export function isParsePagePlaceholderFieldLabel(label: string): boolean {
  return /^字段\d+$/.test(String(label || '').trim());
}

function sampleValuesForImportFieldLabel(
  importRows: StoryboardBulkImportRow[],
  label: string
): string[] {
  const samples: string[] = [];
  for (const row of importRows) {
    for (const field of row.fields) {
      if (field.label !== label && !fieldLabelsMatchParsePage(label, field.label)) continue;
      const value = field.value.trim();
      if (value && value !== '-') samples.push(value);
    }
    if (samples.length >= 2) break;
  }
  return samples.slice(0, 2);
}

export function buildParsePagePlaceholderHint(
  label: string,
  importRows: StoryboardBulkImportRow[]
): string {
  const match = /^字段(\d+)$/.exec(String(label || '').trim());
  const col = match?.[1] ?? '?';
  const samples = sampleValuesForImportFieldLabel(importRows, label);
  const sampleText = samples
    .map((value) => value.replace(/\s+/g, ' ').slice(0, 20))
    .join(' / ');
  if (sampleText) {
    const ellipsis = samples.some((value) => value.length > 20) ? '…' : '';
    return `第${col}列 · 未识别表头 · 样例：${sampleText}${ellipsis}`;
  }
  return `第${col}列 · 未识别表头 · 请重命名或移除`;
}

function enrichParsePageDynamicLabelHints(
  labels: string[],
  hints: Record<string, string>,
  importRows: StoryboardBulkImportRow[]
): Record<string, string> {
  const next = { ...hints };
  for (const label of labels) {
    if (isParsePagePlaceholderFieldLabel(label)) {
      next[label] = buildParsePagePlaceholderHint(label, importRows);
    }
  }
  return next;
}

export function renameParsePageDynamicFieldLabel(
  result: StoryboardParsePageFieldParseResult,
  oldLabel: string,
  newLabelRaw: string
): { ok: true; result: StoryboardParsePageFieldParseResult } | { ok: false; message: string } {
  const trimmed = String(newLabelRaw || '').trim();
  const newLabel = compactParsePageDynamicLabel(trimmed) || trimmed;
  if (!newLabel) return { ok: false, message: '字段名不能为空' };
  if (newLabel === oldLabel) return { ok: true, result };

  if ((STORYBOARD_PARSE_PAGE_FIXED_LABELS as readonly string[]).includes(newLabel as StoryboardParsePageFixedLabel)) {
    return { ok: false, message: `「${newLabel}」为固定字段，无需添加到扩展字段` };
  }
  const mappedFixed = mapHeaderLabelToFixedField(newLabel);
  if (mappedFixed) {
    return { ok: false, message: `「${newLabel}」对应固定字段「${mappedFixed}」` };
  }
  if (result.dynamicLabels.includes(newLabel)) {
    return { ok: false, message: `已存在扩展字段「${newLabel}」` };
  }
  if (!result.dynamicLabels.includes(oldLabel)) {
    return { ok: false, message: `未找到字段「${oldLabel}」` };
  }

  const dynamicLabelHints = { ...result.dynamicLabelHints };
  delete dynamicLabelHints[oldLabel];
  dynamicLabelHints[newLabel] = trimmed.length > newLabel.length ? trimmed : newLabel;

  return {
    ok: true,
    result: {
      ...result,
      dynamicLabels: result.dynamicLabels.map((label) => (label === oldLabel ? newLabel : label)),
      dynamicLabelHints,
      importRows: result.importRows.map((row) => ({
        ...row,
        fields: row.fields.map((field) =>
          field.label === oldLabel ? { ...field, label: newLabel } : field
        ),
      })),
    },
  };
}

function fieldLabelsMatchParsePage(requested: string, source: string): boolean {
  const req = requested.trim();
  const src = source.trim();
  if (!req || !src) return false;
  if (req === src) return true;

  const reqFixed = mapHeaderLabelToFixedField(req);
  const srcFixed = mapHeaderLabelToFixedField(src);
  if (reqFixed && reqFixed === (srcFixed ?? req)) return true;
  if (srcFixed && srcFixed === req) return true;

  const reqCompact = compactParsePageDynamicLabel(req);
  const srcCompact = compactParsePageDynamicLabel(src);
  return reqCompact === srcCompact || req === srcCompact || reqCompact === src;
}

function collectParsePageDynamicLabels(rawLabels: string[]): {
  labels: string[];
  hints: Record<string, string>;
} {
  const labels: string[] = [];
  const hints: Record<string, string> = {};
  const seen = new Set<string>();

  for (const raw of rawLabels) {
    const normalized = normalizeHeaderToken(raw);
    if (!normalized || mapHeaderLabelToFixedField(normalized)) continue;

    const compact = compactParsePageDynamicLabel(normalized);
    if (!compact || seen.has(compact)) continue;
    if ((STORYBOARD_PARSE_PAGE_FIXED_LABELS as readonly string[]).includes(compact)) continue;

    seen.add(compact);
    labels.push(compact);
    hints[compact] = normalized;
  }

  return { labels, hints };
}

function isBroadShotNoToken(raw: string): boolean {
  const token = String(raw || '')
    .trim()
    .replace(/^[【\[]|[】\]]$/g, '')
    .replace(/[.,;，。；]+$/g, '')
    .trim();
  if (!token || token.length > 32) return false;
  if (DURATION_TOKEN_RE.test(token)) return false;
  if (!/\d/.test(token)) return false;
  if (/^\d{4}$/.test(token)) {
    const year = Number(token);
    if (year >= 1900 && year <= 2100) return false;
  }
  if (/^\d{1,4}$/.test(token)) return true;
  if (/^(?:SC|S)\d+(?:[_-]SH?\d+)?$/i.test(token)) return true;
  if (/^[A-Za-z]+[_-]?\d+(?:[_-]\d+)?$/i.test(token)) return true;
  if (/^[A-Za-z]?\d+[A-Za-z]?$/i.test(token)) return true;
  const strict = parseShotNoFromParsedValue(token);
  if (strict) return true;
  return /^[\w-]{1,24}$/i.test(token);
}

export function normalizeBroadStoryboardShotNo(raw: string): string {
  const token = String(raw || '')
    .trim()
    .replace(/^(镜头号|镜号|Shot)\s*[：:]\s*/i, '')
    .replace(/[.,;，。；]+$/g, '')
    .trim()
    .slice(0, 32);
  if (!token || !isBroadShotNoToken(token)) return '';
  const strict = parseShotNoFromParsedValue(token);
  if (strict) return strict;
  if (/^\d+$/.test(token)) return formatStoryboardNumericShotNo(token);
  return token.toUpperCase();
}

export function extractBroadShotNoFromLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed || META_ROW_RE.test(trimmed)) return '';

  const pipeFirst = trimmed.split(/\s*\|\s*/)[0]?.trim() ?? '';
  if (pipeFirst && isBroadShotNoToken(pipeFirst)) {
    return normalizeBroadStoryboardShotNo(pipeFirst);
  }

  const labeled = trimmed.match(/^(?:镜头号|镜号|Shot)\s*[：:]\s*(\S+)/i);
  if (labeled?.[1]) {
    const parsed = normalizeBroadStoryboardShotNo(labeled[1]);
    if (parsed) return parsed;
  }

  const numbered = trimmed.match(/^第?\s*(\d{1,4})\s*镜\b/);
  if (numbered?.[1]) {
    return normalizeBroadStoryboardShotNo(numbered[1]);
  }

  const leading = trimmed.match(/^(\S+)/);
  if (leading?.[1] && isBroadShotNoToken(leading[1])) {
    return normalizeBroadStoryboardShotNo(leading[1]);
  }

  return '';
}

export function detectStoryboardShotTextBlocks(text: string): StoryboardShotTextBlock[] {
  const lines = text.split(/\r?\n/);
  const anchors: Array<{ lineIndex: number; shotNo: string }> = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (!line.trim()) continue;
    const shotNo = extractBroadShotNoFromLine(line);
    if (!shotNo) continue;
    anchors.push({ lineIndex: index, shotNo });
  }

  if (!anchors.length) return [];

  const blocks: StoryboardShotTextBlock[] = [];
  for (let i = 0; i < anchors.length; i += 1) {
    const current = anchors[i]!;
    const next = anchors[i + 1];
    const slice = lines.slice(current.lineIndex, next?.lineIndex ?? lines.length);
    blocks.push({
      shotNo: current.shotNo,
      lineStart: current.lineIndex + 1,
      lineEnd: next ? next.lineIndex : lines.length,
      text: slice.join('\n').trim(),
    });
  }
  return blocks;
}

export type StoryboardRawShotPreview = {
  shotNo: string;
  durationSec: number | null;
  text: string;
  lineStart: number;
  lineEnd: number;
  ready: boolean;
};

export type StoryboardRawShotParseSuccess = {
  ok: true;
  previews: StoryboardRawShotPreview[];
  importRows: StoryboardBulkImportRow[];
  duplicateShotNos: string[];
  skippedMissingDuration: number;
};

export type StoryboardRawShotParseFailure = {
  ok: false;
  message: string;
};

export type StoryboardRawShotParseOutcome =
  | StoryboardRawShotParseSuccess
  | StoryboardRawShotParseFailure;

/** 解析页：仅从镜头块规则提取镜号 + 时长，正文整段保留为 shotRaw */
export function extractDurationSecFromShotBlockText(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const firstLine = trimmed.split(/\r?\n/)[0] ?? '';

  if (/\|/.test(firstLine)) {
    const bulk = parseStoryboardBulkText(firstLine, 'pipe');
    if (bulk.rows[0]?.durationSec != null) return bulk.rows[0].durationSec;
  }

  const normalizedFirst = normalizeFreeformSourceLine(firstLine);
  const freeformMeta = extractShotMetaFromFreeformLine(normalizedFirst);
  if (freeformMeta.durationSec != null) return freeformMeta.durationSec;

  const durationLabel = trimmed.match(/(?:时长|时间|帧数)\s*[：:]\s*([^\n【|]+)/);
  if (durationLabel) {
    const parsed = parseDurationSecFromParsedValue(durationLabel[1]!.trim());
    if (parsed != null) return parsed;
  }

  for (const field of parseTaggedStoryboardFields(trimmed)) {
    if (isSystemDurationLabel(field.label) || field.label === '时长') {
      const parsed = parseDurationSecFromParsedValue(field.value);
      if (parsed != null) return parsed;
    }
  }

  const inline = trimmed.match(/(\d+(?:\.\d+)?)\s*(?:[秒sS]|帧)\b/);
  if (inline) return parseDurationSecFromParsedValue(inline[0]!);

  return null;
}

export function parseStoryboardRawShotsFromText(text: string): StoryboardRawShotParseOutcome {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, message: STORYBOARD_PARSE_PAGE_NO_SHOT_HINT };
  }

  const blocks = detectStoryboardShotTextBlocks(trimmed);
  if (!blocks.length) {
    return { ok: false, message: STORYBOARD_PARSE_PAGE_NO_SHOT_HINT };
  }

  const previews: StoryboardRawShotPreview[] = blocks.map((block) => {
    const durationSec = extractDurationSecFromShotBlockText(block.text);
    return {
      shotNo: block.shotNo,
      durationSec,
      text: block.text,
      lineStart: block.lineStart,
      lineEnd: block.lineEnd,
      ready: durationSec != null,
    };
  });

  const readyPreviews = previews.filter((preview) => preview.ready);
  const importRows: StoryboardBulkImportRow[] = readyPreviews.map((preview) => ({
    shotNo: preview.shotNo,
    durationSec: preview.durationSec,
    shotRaw: preview.text,
    fields: [],
  }));

  const shotNoCounts = new Map<string, number>();
  for (const row of importRows) {
    const key = row.shotNo || '';
    shotNoCounts.set(key, (shotNoCounts.get(key) ?? 0) + 1);
  }
  const duplicateShotNos = [...shotNoCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([shotNo]) => shotNo);

  return {
    ok: true,
    previews,
    importRows,
    duplicateShotNos,
    skippedMissingDuration: previews.length - readyPreviews.length,
  };
}

function uniqueLabels(labels: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const label of labels) {
    const trimmed = label.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function collectDynamicLabelsFromHeaders(headers: string[]): string[] {
  const dynamic: string[] = [];
  for (const header of headers) {
    const normalized = normalizeHeaderToken(header);
    if (!normalized || isSystemShotNoLabel(normalized) || isSystemDurationLabel(normalized)) continue;
    if (mapHeaderLabelToFixedField(normalized)) continue;
    dynamic.push(normalized);
  }
  return uniqueLabels(dynamic);
}

function collectDynamicLabelsFromTagged(text: string): string[] {
  const fields = parseTaggedStoryboardFields(text);
  const dynamic: string[] = [];
  for (const field of fields) {
    const label = field.label.trim();
    if (!label || mapHeaderLabelToFixedField(label)) continue;
    if ((STORYBOARD_PARSE_PAGE_FIXED_LABELS as readonly string[]).includes(label)) continue;
    dynamic.push(label);
  }
  return uniqueLabels(dynamic);
}

function mergeImportRowsFromBulk(text: string): StoryboardBulkImportRow[] {
  const parsed = parseStoryboardBulkText(text, 'pipe');
  return parsed.rows;
}

function parseBlockToImportRow(block: StoryboardShotTextBlock): StoryboardBulkImportRow {
  return buildImportRowFromFreeformShotBlock(block.shotNo, block.text);
}

function buildImportRows(text: string, blocks: StoryboardShotTextBlock[]): StoryboardBulkImportRow[] {
  const bulkRows = mergeImportRowsFromBulk(text);
  if (bulkRows.length >= blocks.length && bulkRows.every((row) => row.shotNo)) {
    return bulkRows;
  }
  return blocks.map(parseBlockToImportRow);
}

function detectFixedLabelsFromImportRows(rows: StoryboardBulkImportRow[], headers: string[]): StoryboardParsePageFixedLabel[] {
  const detected = new Set<StoryboardParsePageFixedLabel>(['镜头号']);
  for (const header of headers) {
    const fixed = mapHeaderLabelToFixedField(header);
    if (fixed) detected.add(fixed);
  }
  for (const row of rows) {
    if (row.durationSec != null) detected.add('时长');
    for (const field of row.fields) {
      if (field.label === '景别' || fieldLabelsMatchParsePage('景别', field.label)) {
        detected.add('景别');
      }
      const fixed = mapHeaderLabelToFixedField(field.label);
      if (fixed) detected.add(fixed);
    }
    if (parseTaggedStoryboardFields(row.shotRaw).some((field) => mapHeaderLabelToFixedField(field.label))) {
      for (const field of parseTaggedStoryboardFields(row.shotRaw)) {
        const fixed = mapHeaderLabelToFixedField(field.label);
        if (fixed) detected.add(fixed);
      }
    }
  }
  return STORYBOARD_PARSE_PAGE_FIXED_LABELS.filter((label) => detected.has(label));
}

/** 第一步：识别镜号 + 固定/动态字段标签（不写表） */
export function parseFieldsFromStoryboardText(text: string): StoryboardParsePageFieldParseOutcome {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, message: STORYBOARD_PARSE_PAGE_NO_SHOT_HINT };
  }

  const shotBlocks = detectStoryboardShotTextBlocks(trimmed);
  if (!shotBlocks.length) {
    return { ok: false, message: STORYBOARD_PARSE_PAGE_NO_SHOT_HINT };
  }

  const bulkPreview = parseStoryboardBulkText(trimmed, 'pipe');
  const importRows = buildImportRows(trimmed, shotBlocks);
  const rawDynamicLabels = uniqueLabels([
    ...collectDynamicLabelsFromHeaders(bulkPreview.headers),
    ...collectDynamicLabelsFromTagged(trimmed),
    ...importRows.flatMap((row) => row.fields.map((field) => field.label)),
  ]);
  const { labels: dynamicLabels, hints: dynamicLabelHintsRaw } =
    collectParsePageDynamicLabels(rawDynamicLabels);
  const dynamicLabelHints = enrichParsePageDynamicLabelHints(
    dynamicLabels,
    dynamicLabelHintsRaw,
    importRows
  );

  const detectedFixedLabels = detectFixedLabelsFromImportRows(importRows, bulkPreview.headers);

  return {
    ok: true,
    shotBlocks,
    fixedLabels: [...STORYBOARD_PARSE_PAGE_FIXED_LABELS],
    dynamicLabels,
    dynamicLabelHints,
    detectedFixedLabels,
    importRows,
  };
}

function fieldValueFromImportRow(
  row: StoryboardBulkImportRow,
  label: string
): string {
  if (label === '镜头号') return row.shotNo ?? '';
  if (label === '时长') {
    if (row.durationSec != null) return `${row.durationSec}s`;
    return '';
  }

  for (const field of row.fields) {
    if (fieldLabelsMatchParsePage(label, field.label)) return field.value.trim();
  }

  const tagged = parseTaggedStoryboardFields(row.shotRaw);
  for (const field of tagged) {
    if (fieldLabelsMatchParsePage(label, field.label)) return field.value.trim();
  }

  return '';
}

function escapeCell(value: string): string {
  return value.replace(/\s*\|\s*/g, ' / ').replace(/\r?\n/g, ' ').trim() || '-';
}

/** 第二步：按确认字段集生成标准管道分镜文本 */
export function generateCanonicalStoryboardBulkText(
  importRows: StoryboardBulkImportRow[],
  confirmedFieldLabels: string[]
): string {
  const labels = confirmedFieldLabels.length
    ? confirmedFieldLabels
    : [...STORYBOARD_PARSE_PAGE_FIXED_LABELS];
  const header = labels.join(CANONICAL_DELIMITER);
  const lines = importRows.map((row) => {
    const cells = labels.map((label) => {
      if (label === '镜头号') return escapeCell(row.shotNo ?? '-');
      if (label === '时长') {
        if (row.durationSec != null) return escapeCell(`${row.durationSec}s`);
        const fromField = fieldValueFromImportRow(row, '时长');
        return escapeCell(fromField || '-');
      }
      const value = fieldValueFromImportRow(row, label);
      return escapeCell(value || '-');
    });
    return cells.join(CANONICAL_DELIMITER);
  });
  return [header, ...lines].join('\n');
}

export function buildConfirmedParsePageFieldLabels(
  dynamicLabels: string[],
  removedDynamicLabels: ReadonlySet<string>,
  addedDynamicLabels: ReadonlySet<string>
): string[] {
  const dynamic = uniqueLabels([
    ...dynamicLabels.filter((label) => !removedDynamicLabels.has(label)),
    ...addedDynamicLabels,
  ]).filter((label) => !mapHeaderLabelToFixedField(label));
  return [...STORYBOARD_PARSE_PAGE_FIXED_LABELS, ...dynamic];
}

/**
 * 按解析页确认的字段集构建写入行（与标准分镜预览同源，不再二次规则解析管道文本）
 */
export function buildBulkImportRowsForParsePageWrite(
  result: StoryboardParsePageFieldParseResult,
  confirmedLabels: string[],
  canonicalText?: string
): StoryboardBulkImportRow[] {
  const canonicalLines = canonicalText?.trim().split(/\r?\n/).slice(1) ?? [];

  return result.importRows.map((row, index) => {
    const fields: StoryboardParseFieldItem[] = [];
    for (const label of confirmedLabels) {
      if (label === '镜头号' || label === '时长') continue;
      const value = fieldValueFromImportRow(row, label);
      if (!value || value === '-') continue;
      fields.push({
        label,
        value,
        kind: value.length > 48 && /画面|运镜|备注|描述/.test(label) ? 'multiline' : 'text',
        redrawInclude: inferParsePageFieldRedrawInclude(label),
      });
    }

    return {
      shotNo: row.shotNo,
      durationSec: row.durationSec,
      shotRaw: canonicalLines[index]?.trim() || row.shotRaw,
      fields,
    };
  });
}

export function inferParsePageFieldRedrawInclude(label: string): boolean {
  if (/对白|台词|音效|备注|音乐|旁白/.test(label)) return false;
  return true;
}

export function parseCanonicalStoryboardBulkText(text: string) {
  return parseStoryboardBulkText(text, 'pipe');
}

/** 解析页 LLM 提示：固定 8 字段 + 短扩展标签（legacy JSON 解析路径） */
export function buildParsePageLlmFieldHint(): string {
  return `\n\n【解析页字段规范】
必须使用下列固定 label（字面一致）：${STORYBOARD_PARSE_PAGE_FIXED_LABELS.join('、')}。
- 「画面」：场景/动作/视觉内容（不要写运镜）
- 「运镜」：机位/镜头运动/构图（不要写画面）
- 「焦距」：如 50mm；无则不要输出该字段
- 「备注」：音效、服化道、光影等未归入前述列的原文信息
- 「时长」value 带 s 或「帧」；「镜头号」与「时长」也可写在 fields 里
- 其它维度作扩展字段，label 2～4 字
每镜单独一条 row；不要输出空 value；不要重复镜号。`;
}

export const DEFAULT_STORYBOARD_PARSE_PAGE_FORMAT_INSTRUCTION = `你是分镜表格式转换助手。用户粘贴任意形式的分镜脚本文本。

任务：只做格式整理，不改写内容。将原文信息映射到固定列的管道符表格，保留原文措辞（不要润色、翻译、合并或删减语义）。

【输出表头 — 必须完全一致，不得增删列】
${STORYBOARD_PARSE_PAGE_CANONICAL_HEADER}

【行规则】
- 从第二行起每镜一行，列数 8，用「 | 」（空格+竖线+空格）分隔
- 缺失项写「-」
- 跳过章节/幕标题、统筹说明、重复表头；只输出含合法镜头号的镜头行
- 镜号与原文一致；纯数字镜号统一三位（1→001）
- 「画面」：场景/动作/视觉内容（不含运镜描述）
- 「运镜」：机位/镜头运动/构图（不含画面内容）
- 「备注」：音效、服化道、光影、注释等未归入前述列的原文信息；无则「-」
- 时长保留原文单位（如 3.0s、24帧）
- 不要输出 markdown 代码块

只输出 JSON：
{
  "isStoryboard": true,
  "normalizedText": "${STORYBOARD_PARSE_PAGE_CANONICAL_HEADER}\\n001 | 2.5s | 远景 | - | 城市夜景 | - | - | -"
}
或
{
  "isStoryboard": false,
  "reason": "未识别为分镜脚本"
}`;

export type StoryboardParsePageFormatConvertSuccess = {
  ok: true;
  normalizedText: string;
  rowCount: number;
};

export type StoryboardParsePageFormatConvertFailure = {
  ok: false;
  message: string;
};

export type StoryboardParsePageFormatConvertOutcome =
  | StoryboardParsePageFormatConvertSuccess
  | StoryboardParsePageFormatConvertFailure;

/** 解析页：整篇 LLM 转为固定 8 列管道符格式（只改结构不改内容） */
export async function convertStoryboardParsePageFormatWithLlm(
  text: string,
  preset: CustomAppModule,
  ctx: CapabilityExecuteContext
): Promise<StoryboardParsePageFormatConvertOutcome> {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, message: STORYBOARD_PARSE_PAGE_NO_SHOT_HINT };
  }

  const formatPreset = {
    ...preset,
    textModelRegistryId:
      (preset.textModelRegistryId || '').trim() || STORYBOARD_PARSE_PAGE_FORMAT_MODEL_ID,
  };

  try {
    const ai = await normalizeStoryboardBulkWithAi(trimmed, formatPreset, ctx, {
      instruction: DEFAULT_STORYBOARD_PARSE_PAGE_FORMAT_INSTRUCTION,
      mode: 'pipe',
      maxChars: STORYBOARD_BULK_PARSE_MAX_CHARS,
    });
    if (!ai.isStoryboard) {
      return { ok: false, message: ai.reason };
    }
    return {
      ok: true,
      normalizedText: ai.normalizedText,
      rowCount: ai.parsed.rows.length,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

function normalizeLlmParsePageFieldLabel(label: string): string {
  const fixed = mapHeaderLabelToFixedField(label);
  if (fixed) return fixed;
  return compactParsePageDynamicLabel(label) || label.trim();
}

function llmRowToImportRow(row: StoryboardBulkParseModelRow): StoryboardBulkImportRow {
  const fields: StoryboardParseFieldItem[] = [];
  let durationSec: number | null = null;
  let shotNo = parseShotNoFromParsedValue(row.shotNo) ?? formatStoryboardNumericShotNo(row.shotNo);

  for (const item of row.fields) {
    const label = normalizeLlmParsePageFieldLabel(item.label);
    const value = item.value.trim();
    if (!label || !value) continue;
    if (label === '镜头号') {
      const parsed = parseShotNoFromParsedValue(value);
      if (parsed) shotNo = parsed;
      continue;
    }
    if (label === '时长') {
      const parsed = parseDurationSecFromParsedValue(value);
      if (parsed != null) durationSec = parsed;
      continue;
    }
    fields.push({
      ...item,
      label,
      redrawInclude: item.redrawInclude ?? inferParsePageFieldRedrawInclude(label),
    });
  }

  const shotRaw = row.fields
    .map((field) => `【${field.label.trim()}】${field.value.trim()}`)
    .filter(Boolean)
    .join('\n');

  return {
    shotNo,
    durationSec,
    shotRaw,
    fields,
  };
}

/** 将 LLM 批量结构化结果转为解析页字段识别结果 */
export function llmBulkOutputToParsePageResult(
  output: StoryboardBulkParseModelOutput,
  sourceText: string
): StoryboardParsePageFieldParseResult {
  const importRows = output.rows.map(llmRowToImportRow);
  const rawDynamicLabels = uniqueLabels(
    importRows.flatMap((row) => row.fields.map((field) => field.label))
  );
  const { labels: dynamicLabels, hints: dynamicLabelHintsRaw } =
    collectParsePageDynamicLabels(rawDynamicLabels);
  const dynamicLabelHints = enrichParsePageDynamicLabelHints(
    dynamicLabels,
    dynamicLabelHintsRaw,
    importRows
  );

  const detected = new Set<StoryboardParsePageFixedLabel>(['镜头号']);
  for (const row of importRows) {
    if (row.durationSec != null) detected.add('时长');
    for (const label of STORYBOARD_PARSE_PAGE_FIXED_LABELS) {
      if (label === '镜头号' || label === '时长') continue;
      const value = fieldValueFromImportRow(row, label);
      if (value && value !== '-') detected.add(label);
    }
  }

  const shotBlocks: StoryboardShotTextBlock[] = importRows.map((row, index) => ({
    shotNo: row.shotNo ?? formatStoryboardNumericShotNo(String(index + 1)),
    lineStart: index + 1,
    lineEnd: index + 1,
    text: row.shotRaw || sourceText,
  }));

  return {
    ok: true,
    shotBlocks,
    fixedLabels: [...STORYBOARD_PARSE_PAGE_FIXED_LABELS],
    dynamicLabels,
    dynamicLabelHints,
    detectedFixedLabels: STORYBOARD_PARSE_PAGE_FIXED_LABELS.filter((label) => detected.has(label)),
    importRows,
  };
}

/** 解析页：LLM 识别字段（替代规则 parseFieldsFromStoryboardText） */
export async function parseStoryboardParsePageWithLlm(
  text: string,
  preset: CustomAppModule,
  ctx: CapabilityExecuteContext
): Promise<StoryboardParsePageFieldParseOutcome> {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, message: STORYBOARD_PARSE_PAGE_NO_SHOT_HINT };
  }

  // 整篇一次 LLM；preset 仅用于模型路由，instruction 固定为批量 rows JSON + 解析页 7 字段
  const instruction = `${DEFAULT_STORYBOARD_BULK_PARSE_INSTRUCTION}\n${buildParsePageLlmFieldHint()}`.trim();
  const output = await parseStoryboardBulkStructuredWithPreset(
    trimmed,
    { ...preset, instruction },
    ctx
  );
  return llmBulkOutputToParsePageResult(output, trimmed);
}
