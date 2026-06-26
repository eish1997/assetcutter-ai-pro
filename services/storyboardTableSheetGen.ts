import type { CustomAppModule, StoryboardParseFieldDef, StoryboardTableRow } from '../types';
import { applyStoryboardBulkImport, parseStoryboardBulkText, type StoryboardBulkTextMode } from './storyboardTableBulkImport';
import { compileRedrawPrompt } from './storyboardTableParse';
import {
  capabilityUsesGenImageEngine,
  executeCapability,
  getCapabilityEngine,
  type CapabilityExecuteContext,
} from './capabilityExecutor';
import { auditStoryboardGenFromCtx } from './storyboardTaskAuditEvents';
import {
  WORKFLOW_IMAGE_GEN_PROMPT_OFFICIAL_MAX_CHARS,
  WORKFLOW_IMAGE_GEN_PROMPT_RECOMMENDED_MAX_CHARS,
} from './workflowTextLimits';
import { probeCompanionHealth } from './companionClient/probe';
import { imageSrcToDataUrlForCompanion } from './workflowCompanionAssets';

export const STORYBOARD_SHEET_SHOTS_PER_IMAGE_KEY = 'ac_storyboard_sheet_shots_per_image_v1';
export const STORYBOARD_SHEET_GEN_EXTRA_PROMPT_KEY = 'ac_storyboard_sheet_gen_extra_prompt_v1';
export const STORYBOARD_SHEET_GEN_BATCH_CONCURRENCY = 2;

export type StoryboardSheetGenPromptStats = {
  compiledChars: number;
  presetChars: number;
  mergedChars: number;
  sendLimit: number;
  officialApiMax: number;
};

/** 直发提示词时，与生图模型收到的正文一致（镜头正文优先，预设画风置后） */
export function buildStoryboardSheetGenMergedSendPrompt(
  compiledPrompt: string,
  preset: CustomAppModule
): string {
  const compiled = String(compiledPrompt ?? '').trim();
  const presetText = (preset.instruction || '').trim();
  if (!presetText) return compiled;
  return `${compiled}\n\n【画风/执行要求】\n${presetText}`;
}

/** 拼图生图一律直发，避免「理解」把多镜正文压成泛化描述 */
export function resolveStoryboardSheetGenDirectPreset(preset: CustomAppModule): CustomAppModule {
  if (preset.skipUnderstand === true) return preset;
  return { ...preset, skipUnderstand: true };
}

export type StoryboardSheetGenBatchPreview = {
  chunkIndex: number;
  shotCount: number;
  shotLabels: string;
  compiledPrompt: string;
  /** 直发时与生图模型一致；理解模式下为空 */
  mergedImagePrompt: string;
  directSend: boolean;
  stats: StoryboardSheetGenPromptStats;
  validationOk: boolean;
  validationError?: string;
};

export function buildStoryboardSheetGenBatchPreviews(args: {
  tasks: StoryboardSheetGenTask[];
  fieldCatalog: StoryboardParseFieldDef[];
  promptExtra: string;
  preset: CustomAppModule;
}): StoryboardSheetGenBatchPreview[] {
  return args.tasks.map((task) => {
    const compiledPrompt = compileSheetRedrawPrompt(task.rows, args.fieldCatalog, {
      promptExtra: args.promptExtra,
    });
    const stats = measureStoryboardSheetGenPrompt(compiledPrompt, args.preset);
    const validation = validateStoryboardSheetGenPromptLength(compiledPrompt, args.preset, {}, {
      shotCount: task.rows.length,
    });
    const directSend = resolveStoryboardSheetGenDirectPreset(args.preset).skipUnderstand === true;
    return {
      chunkIndex: task.chunkIndex,
      shotCount: task.rows.length,
      shotLabels: task.rows
        .map((row) => row.shotNo?.trim() || `${row.index + 1}`)
        .join('、'),
      compiledPrompt,
      mergedImagePrompt: directSend
        ? buildStoryboardSheetGenMergedSendPrompt(compiledPrompt, args.preset)
        : '',
      directSend,
      stats,
      validationOk: validation.ok,
      validationError: validation.ok ? undefined : validation.error,
    };
  });
}

/** 编译后镜头正文 + 预设提示词合并后的送模字数（不截断、不改写） */
export function measureStoryboardSheetGenPrompt(
  compiledPrompt: string,
  preset: CustomAppModule
): StoryboardSheetGenPromptStats {
  const compiled = String(compiledPrompt ?? '').trim();
  const presetText = (preset.instruction || '').trim();
  const mergedChars = presetText ? `${presetText}\n\n${compiled}`.length : compiled.length;
  return {
    compiledChars: compiled.length,
    presetChars: presetText.length,
    mergedChars,
    sendLimit: WORKFLOW_IMAGE_GEN_PROMPT_RECOMMENDED_MAX_CHARS,
    officialApiMax: WORKFLOW_IMAGE_GEN_PROMPT_OFFICIAL_MAX_CHARS,
  };
}

function formatStoryboardSheetGenLimitError(stats: StoryboardSheetGenPromptStats): string {
  return (
    `拼图送模约 ${stats.mergedChars} 字（镜头正文 ${stats.compiledChars} + 预设 ${stats.presetChars}），` +
    `超过推荐上限 ${stats.sendLimit} 字。请减少「每图镜头数」或缩短镜头描述；系统不会截断后代为生成。`
  );
}

/** 送模前校验：超长则拒绝执行，不截断、不改写 */
export function validateStoryboardSheetGenPromptLength(
  compiledPrompt: string,
  preset: CustomAppModule,
  _ctx: CapabilityExecuteContext,
  opts?: { shotCount?: number }
): { ok: true; stats: StoryboardSheetGenPromptStats } | { ok: false; error: string; stats: StoryboardSheetGenPromptStats } {
  const text = String(compiledPrompt ?? '').trim();
  const stats = measureStoryboardSheetGenPrompt(text, preset);
  if (!text) {
    return { ok: false, error: '请先填写或导入分镜内容', stats };
  }

  const shotCount = opts?.shotCount ?? 0;
  if (shotCount > 1 && preset.skipUnderstand !== true) {
    return {
      ok: false,
      stats,
      error:
        `本批 ${shotCount} 镜拼图：预设「${preset.label || preset.id}」已启用「理解」，会把多镜提示词改写为单段描述，无法稳定生成网格分镜表。` +
        `请在功能区将该预设设为「直发提示词」后再试。`,
    };
  }

  if (stats.mergedChars > stats.sendLimit) {
    return { ok: false, error: formatStoryboardSheetGenLimitError(stats), stats };
  }

  if (stats.mergedChars > stats.officialApiMax) {
    return {
      ok: false,
      stats,
      error:
        `拼图送模约 ${stats.mergedChars} 字，超过生图 API 硬顶 ${stats.officialApiMax} 字。请减少每图镜头数或缩短描述。`,
    };
  }

  return { ok: true, stats };
}

export const STORYBOARD_SHEET_SHOTS_PER_IMAGE_OPTIONS = [4, 6, 9, 12, 16, 20, 25, 30, 36] as const;

export type StoryboardSheetGenBatchRequest = {
  presetId: string;
  shotsPerSheet: number;
  promptExtra: string;
  /** @deprecated 改图资产已移至 AI 拼图下方；初次生图不再使用 */
  referenceImageDataUrl?: string;
  /** 图生图预设初次批量生图时强制走文生图 */
  forceTextToImage?: boolean;
  sourceRows: StoryboardTableRow[];
  fieldCatalog: StoryboardParseFieldDef[];
  /** 仅生成这些 chunkIndex；缺省或空数组表示全部 */
  selectedChunkIndexes?: number[];
};

export type StoryboardSheetGenTask = {
  chunkIndex: number;
  rows: StoryboardTableRow[];
  rowIds: string[];
};

export type StoryboardSheetGenChunkResult =
  | { chunkIndex: number; rowIds: string[]; ok: true; image: string }
  | { chunkIndex: number; rowIds: string[]; ok: false; error: string; cancelled?: boolean };

export class StoryboardSheetGenBatchController {
  private cancelled = new Set<number>();
  private abortAll = false;

  cancelChunk(chunkIndex: number): void {
    this.cancelled.add(chunkIndex);
  }

  cancelPendingChunks(chunkIndexes: number[]): void {
    for (const chunkIndex of chunkIndexes) {
      this.cancelled.add(chunkIndex);
    }
  }

  abort(): void {
    this.abortAll = true;
  }

  isCancelled(chunkIndex: number): boolean {
    return this.abortAll || this.cancelled.has(chunkIndex);
  }
}

export type StoryboardSheetGenBatchResult = {
  tasks: StoryboardSheetGenTask[];
  results: StoryboardSheetGenChunkResult[];
  okCount: number;
  failCount: number;
};

export function normalizeShotsPerSheet(value: unknown, fallback = 25): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(60, Math.max(1, Math.round(n)));
}

export function chunkStoryboardRowsByCount<T>(items: T[], size: number): T[][] {
  const chunkSize = normalizeShotsPerSheet(size);
  if (!items.length) return [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    out.push(items.slice(i, i + chunkSize));
  }
  return out;
}

export function rowHasSheetGenPrompt(
  row: StoryboardTableRow,
  catalog: StoryboardParseFieldDef[]
): boolean {
  if (normalizeSheetInlineText(row.shotRaw || '')) return true;
  if (normalizeSheetInlineText(row.shotText || '')) return true;
  return Boolean(compileSheetShotCompactBlock(row, catalog).trim());
}

export function resolveSheetGenSourceRows(
  tableRows: StoryboardTableRow[],
  bulkText: string,
  bulkMode: StoryboardBulkTextMode,
  fieldCatalog: StoryboardParseFieldDef[]
): { rows: StoryboardTableRow[]; catalog: StoryboardParseFieldDef[]; source: 'table' | 'draft' } {
  const eligibleTableRows = tableRows.filter((row) => !row.locked && rowHasSheetGenPrompt(row, fieldCatalog));
  if (eligibleTableRows.length > 0) {
    return { rows: eligibleTableRows, catalog: fieldCatalog, source: 'table' };
  }

  const parsed = parseStoryboardBulkText(bulkText, bulkMode);
  if (!parsed.rows.length) {
    return { rows: [], catalog: fieldCatalog, source: 'draft' };
  }
  const imported = applyStoryboardBulkImport(fieldCatalog, [], parsed.rows, 'replace');
  return { rows: imported.rows, catalog: imported.catalog, source: 'draft' };
}

export function planStoryboardSheetGenTasks(
  rows: StoryboardTableRow[],
  shotsPerSheet: number
): StoryboardSheetGenTask[] {
  const eligible = rows.filter((row) => !row.locked);
  const chunks = chunkStoryboardRowsByCount(eligible, shotsPerSheet);
  return chunks.map((chunkRows, chunkIndex) => ({
    chunkIndex,
    rows: chunkRows,
    rowIds: chunkRows.map((row) => row.id),
  }));
}

export function compileSheetRedrawPrompt(
  rows: StoryboardTableRow[],
  catalog: StoryboardParseFieldDef[],
  opts?: { promptExtra?: string }
): string {
  const parts: string[] = [];
  const extra = (opts?.promptExtra || '').trim();
  if (extra) parts.push(extra);

  if (rows.length > 0) {
    parts.push(buildStoryboardSheetLayoutPrompt(rows.length));
  }

  rows.forEach((row, index) => {
    const body = compileSheetShotCompactBlock(row, catalog);
    if (!body) return;
    const label = row.shotNo?.trim() || `镜头 ${index + 1}`;
    parts.push(`--- ${label} ---\n${body}`);
  });

  return parts.join('\n\n').trim();
}

export function sheetGenTaskCount(shotCount: number, shotsPerSheet: number): number {
  if (shotCount <= 0) return 0;
  return Math.ceil(shotCount / normalizeShotsPerSheet(shotsPerSheet));
}

/** 拼图列数：偏多列，减少单格高度与底部留白 */
export function resolveStoryboardSheetGridDimensions(shotCount: number): { cols: number; rows: number } {
  if (shotCount <= 0) return { cols: 1, rows: 1 };
  if (shotCount === 1) return { cols: 1, rows: 1 };
  if (shotCount <= 4) return { cols: 2, rows: 2 };
  if (shotCount <= 6) return { cols: 3, rows: 2 };
  if (shotCount <= 9) return { cols: 3, rows: 3 };
  if (shotCount <= 12) return { cols: 4, rows: 3 };
  if (shotCount <= 16) return { cols: 4, rows: 4 };
  if (shotCount <= 20) return { cols: 5, rows: 4 };
  const cols = 5;
  return { cols, rows: Math.ceil(shotCount / cols) };
}

export function buildStoryboardSheetLayoutPrompt(shotCount: number): string {
  const { cols, rows } = resolveStoryboardSheetGridDimensions(shotCount);
  return [
    '【拼图排版·紧凑】',
    `整张图为 ${cols} 列 × ${rows} 行分镜表拼图，必须画满 ${shotCount} 格，格与格之间细线分隔，外边距窄，禁止大块空白背景。`,
    '每一格自上而下三段，高度比例约 顶 8% / 中 62% / 底 30%，禁止预留空白文字区：',
    '1. 顶栏：单行小字，镜号 | 景别 | 角度 | 运镜 | 时长（与下方镜头数据一致，字号小、行距紧）',
    '2. 中间：分镜草图/插画（主体，尽量占满中段，不要四周大留白）',
    '3. 底栏：画面描述一行；对白一行（无对白写「对白：-」），小字、最多两行，不要留空黑条',
    '禁止只画空白格、占位框或纯文字条而无插画；每一格中段必须有与该镜「画面」描述一致的可识别主体/场景。',
    '各格插图必须严格对应下列各镜的独立描述，禁止所有格子重复同一构图、同一剧情瞬间或同一背景套路。',
    '禁止忽略下列镜头文字自行编造无关剧情、人物或场景；每一格必须与对应镜号下的「画面」一致。',
    '镜号必须与下列各镜一致；按行列顺序从左到右、从上到下排列。',
  ].join('\n');
}

const SHEET_HEADER_SHOT_SCALE_RE = /景别/i;
const SHEET_HEADER_DURATION_RE = /时长/i;
const SHEET_VISUAL_FIELD_RE = /画面|内容|描述|动作/i;
const SHEET_DIALOGUE_FIELD_RE = /对白|旁白|台词|声音|音效/i;
/** 常见短元信息字段（无标题、合并一行） */
const SHEET_SHORT_META_LABEL_RE =
  /景别|角度|运镜|机位|焦距|构图|镜别|升降|摇|移|跟|推拉|旋|俯|仰|拍法|镜头类型/i;
/** 较长补充信息，不进短元信息行 */
const SHEET_SUPPLEMENTAL_LABEL_RE =
  /光影|服化|道具|化妆|妆造|备注|说明|设计|氛围|色调|声音|特效/i;

const SHEET_COMPACT_VALUE_MAX_LEN = 12;

function normalizeSheetInlineText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function isSheetShortMetaField(label: string, value: string): boolean {
  if (SHEET_HEADER_DURATION_RE.test(label)) return false;
  if (SHEET_VISUAL_FIELD_RE.test(label)) return false;
  if (SHEET_DIALOGUE_FIELD_RE.test(label)) return false;
  if (SHEET_SUPPLEMENTAL_LABEL_RE.test(label)) return false;
  if (SHEET_SHORT_META_LABEL_RE.test(label)) return true;
  return normalizeSheetInlineText(value).length <= SHEET_COMPACT_VALUE_MAX_LEN;
}

function isSheetDescriptionField(label: string): boolean {
  return SHEET_VISUAL_FIELD_RE.test(label) || label === '原文';
}

export type SheetShotPanelCompactLayout = {
  /** 镜号 | 时长 */
  headerLine: string;
  /** 短元信息（无标题），如「大远景 · 平视 · 固定」 */
  metaLine: string;
  /** 主画面描述 */
  description: string;
  /** 其余较长字段，仅值、无标题，DOM 双列 */
  extraLines: SheetShotPanelCompactExtra[];
};

export type SheetShotPanelCompactExtra = {
  text: string;
  dialogue?: boolean;
};

function isSheetPlaceholder(value: string): boolean {
  const t = value.trim();
  return !t || t === '-' || t === '—' || t === '–' || t === '无';
}

export type SheetShotPanelFieldLine = {
  label: string;
  value: string;
};

export type SheetShotPanelMeta = {
  headerLine: string;
  visualLine: string;
  dialogueLine: string;
  /** catalog 内全部非空字段（含对白等 redrawInclude:false） */
  fieldLines: SheetShotPanelFieldLine[];
  compactLayout: SheetShotPanelCompactLayout;
};

function resolveSheetPanelDurationLabel(
  row: StoryboardTableRow,
  fieldLines: SheetShotPanelFieldLine[]
): string {
  for (const line of fieldLines) {
    if (SHEET_HEADER_DURATION_RE.test(line.label)) {
      return normalizeSheetInlineText(line.value);
    }
  }
  if (row.durationSec != null && Number.isFinite(row.durationSec)) {
    const sec = row.durationSec;
    return Number.isInteger(sec) ? `${sec}s` : `${sec.toFixed(1)}s`;
  }
  return '';
}

/** 紧凑排版：顶栏镜号+时长，短字段一行，描述固定，其余双列 */
export function compileSheetShotPanelCompactLayout(
  row: StoryboardTableRow,
  fieldLines: SheetShotPanelFieldLine[]
): SheetShotPanelCompactLayout {
  const shotNo = (row.shotNo || '').trim();
  const durationLabel = resolveSheetPanelDurationLabel(row, fieldLines);
  const headerParts = [shotNo, durationLabel].filter(Boolean);
  const headerLine = headerParts.join(' | ');

  const pool = fieldLines.filter((line) => !SHEET_HEADER_DURATION_RE.test(line.label));
  const descriptionParts: string[] = [];
  for (let i = pool.length - 1; i >= 0; i -= 1) {
    const line = pool[i]!;
    if (isSheetDescriptionField(line.label)) {
      descriptionParts.unshift(normalizeSheetInlineText(line.value));
      pool.splice(i, 1);
    }
  }
  let description = descriptionParts.filter(Boolean).join('；');
  if (!description) {
    let bestIdx = -1;
    let bestLen = 0;
    pool.forEach((line, idx) => {
      if (SHEET_DIALOGUE_FIELD_RE.test(line.label)) return;
      const len = normalizeSheetInlineText(line.value).length;
      if (len > bestLen) {
        bestLen = len;
        bestIdx = idx;
      }
    });
    if (bestIdx >= 0 && bestLen > SHEET_COMPACT_VALUE_MAX_LEN) {
      description = normalizeSheetInlineText(pool[bestIdx]!.value);
      pool.splice(bestIdx, 1);
    }
  }

  const metaValues: string[] = [];
  const extraLines: SheetShotPanelCompactExtra[] = [];
  for (const line of pool) {
    const value = normalizeSheetInlineText(line.value);
    if (!value) continue;
    if (isSheetShortMetaField(line.label, value)) {
      metaValues.push(value);
    } else {
      const entry: SheetShotPanelCompactExtra = { text: value };
      if (SHEET_DIALOGUE_FIELD_RE.test(line.label)) entry.dialogue = true;
      extraLines.push(entry);
    }
  }

  if (!description) {
    const shotText = normalizeSheetInlineText(row.shotText || '');
    if (shotText) description = shotText;
    else {
      const shotRaw = normalizeSheetInlineText(row.shotRaw || '');
      if (shotRaw) description = shotRaw;
    }
  }

  return {
    headerLine,
    metaLine: metaValues.join(' · '),
    description,
    extraLines,
  };
}

/** 收集镜头全部非空结构化字段（catalog 顺序，空值跳过） */
export function compileSheetShotPanelFieldLines(
  row: StoryboardTableRow,
  catalog: StoryboardParseFieldDef[]
): SheetShotPanelFieldLine[] {
  const lines: SheetShotPanelFieldLine[] = [];
  let hasDurationField = false;

  for (const def of [...catalog].sort((a, b) => a.order - b.order)) {
    const label = def.label.trim();
    const value = String(row.shotFields[def.id] || '').trim();
    if (SHEET_HEADER_DURATION_RE.test(label) && !isSheetPlaceholder(value)) {
      hasDurationField = true;
    }
    if (isSheetPlaceholder(value)) continue;
    lines.push({ label, value });
  }

  if (
    !hasDurationField &&
    row.durationSec != null &&
    Number.isFinite(row.durationSec)
  ) {
    lines.push({ label: '时长', value: `${row.durationSec}s` });
  }

  if (!lines.length) {
    const shotText = (row.shotText || '').trim();
    const shotRaw = (row.shotRaw || '').trim();
    if (shotText) lines.push({ label: '原文', value: shotText });
    else if (shotRaw) lines.push({ label: '原文', value: shotRaw });
  }

  return lines;
}

function resolveSheetGenVisualLine(
  row: StoryboardTableRow,
  catalog: StoryboardParseFieldDef[],
  structuredVisual: string,
  compactDescription: string
): string {
  const shotRaw = compactSheetPanelMetaLine(row.shotRaw || '');
  const shotText = compactSheetPanelMetaLine(row.shotText || '');
  const rawPrimary = shotRaw || shotText;
  let visual = compactSheetPanelMetaLine(structuredVisual);

  if (rawPrimary) {
    if (!visual || rawPrimary.length >= visual.length) {
      visual = rawPrimary;
    }
  }

  if (!visual) {
    const fromCompact = compactSheetPanelMetaLine(compactDescription);
    if (fromCompact) visual = fromCompact;
  }

  const shotNo = (row.shotNo || '').trim();
  if (!visual && shotNo) {
    const fallback = compileRedrawPrompt(row, catalog).trim();
    if (fallback) visual = fallback.replace(/\n+/g, ' ');
  }

  return visual.replace(/\s+/g, ' ').trim();
}

/** 单镜紧凑字段块（供拼图生图，避免冗长换行撑高格子） */
export function compileSheetShotPanelMeta(
  row: StoryboardTableRow,
  catalog: StoryboardParseFieldDef[]
): SheetShotPanelMeta {
  const fieldLines = compileSheetShotPanelFieldLines(row, catalog);
  const compactLayout = compileSheetShotPanelCompactLayout(row, fieldLines);
  const shotNo = (row.shotNo || '').trim();

  let visual = '';
  let dialogue = '';

  for (const def of [...catalog].sort((a, b) => a.order - b.order)) {
    if (!def.redrawInclude) continue;
    const value = String(row.shotFields[def.id] || '').trim();
    if (isSheetPlaceholder(value)) continue;
    const label = def.label.trim();
    if (SHEET_DIALOGUE_FIELD_RE.test(label)) {
      dialogue = value;
    } else if (SHEET_VISUAL_FIELD_RE.test(label)) {
      visual = visual ? `${visual}；${value}` : value;
    }
  }

  if (!visual) {
    const fromCompact = compactSheetPanelMetaLine(compactLayout.description);
    if (fromCompact) visual = fromCompact;
  }

  visual = resolveSheetGenVisualLine(row, catalog, visual, compactLayout.description);

  return {
    headerLine: compactLayout.headerLine || shotNo,
    visualLine: visual,
    dialogueLine:
      dialogue && !isSheetPlaceholder(dialogue) ? dialogue.replace(/\s+/g, ' ') : '-',
    fieldLines,
    compactLayout,
  };
}

function compactSheetPanelMetaLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function compileSheetShotCompactBlock(
  row: StoryboardTableRow,
  catalog: StoryboardParseFieldDef[]
): string {
  const meta = compileSheetShotPanelMeta(row, catalog);
  const lines: string[] = [];
  if (meta.headerLine) lines.push(`顶栏：${meta.headerLine}`);
  if (meta.compactLayout.metaLine) {
    lines.push(`元信息：${compactSheetPanelMetaLine(meta.compactLayout.metaLine)}`);
  }
  const visualBody =
    meta.visualLine || compactSheetPanelMetaLine(meta.compactLayout.description);
  if (visualBody) lines.push(`画面：${visualBody}`);
  lines.push(
    `对白：${
      meta.dialogueLine === '-'
        ? meta.dialogueLine
        : compactSheetPanelMetaLine(meta.dialogueLine)
    }`
  );
  return lines.join('\n');
}

export function listStoryboardSheetGenPresets(presets: CustomAppModule[]): CustomAppModule[] {
  return presets.filter((p) => {
    if (p.enabled === false) return false;
    if (!capabilityUsesGenImageEngine(p)) return false;
    return p.category === 'text_to_image' || p.category === 'image_to_image';
  });
}

async function mapLimit<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
  shouldSkip?: (item: T, index: number) => boolean
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      const item = items[i]!;
      if (shouldSkip?.(item, i)) continue;
      results[i] = await mapper(item, i);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export type StoryboardSheetGenArgs = {
  preset: CustomAppModule;
  rows: StoryboardTableRow[];
  fieldCatalog: StoryboardParseFieldDef[];
  ctx: CapabilityExecuteContext;
  promptExtra?: string;
  referenceImageDataUrl?: string;
  forceTextToImage?: boolean;
  chunkIndex?: number;
};

export async function executeStoryboardSheetGen(
  args: StoryboardSheetGenArgs
): Promise<{ ok: true; image: string } | { ok: false; error: string }> {
  const { preset: rawPreset, rows, fieldCatalog, ctx, promptExtra, referenceImageDataUrl, forceTextToImage } = args;
  const preset = resolveStoryboardSheetGenDirectPreset(rawPreset);

  if (getCapabilityEngine(preset) !== 'gen_image') {
    return { ok: false, error: '请选择文生图或图生图类能力' };
  }
  if (!rows.length) {
    return { ok: false, error: '本任务没有可用镜头' };
  }

  const compiledPrompt = compileSheetRedrawPrompt(rows, fieldCatalog, { promptExtra });
  const lengthCheck = validateStoryboardSheetGenPromptLength(compiledPrompt, preset, ctx, {
    shotCount: rows.length,
  });
  if (!lengthCheck.ok) {
    return { ok: false, error: lengthCheck.error };
  }
  const inputText = compiledPrompt;
  const { stats } = lengthCheck;
  ctx.onLog?.(
    'info',
    `分镜表 · 批 ${args.chunkIndex != null ? args.chunkIndex + 1 : 1} · ${rows.length} 镜 · 送模约 ${stats.mergedChars} 字（正文 ${stats.compiledChars} + 预设 ${stats.presetChars}，上限 ${stats.sendLimit}）· 直发送模`,
    undefined
  );

  if (rawPreset.skipUnderstand !== true) {
    ctx.onLog?.(
      'info',
      `分镜表 · ${rawPreset.label || rawPreset.id} · 拼图生图已强制直发（忽略预设「理解」以免改写多镜正文）`,
      undefined
    );
  }

  const ref = String(referenceImageDataUrl || '').trim();
  const useImageRef = !forceTextToImage && preset.category === 'image_to_image' && Boolean(ref);

  let inputImage = '';
  if (useImageRef) {
    const normalized = await imageSrcToDataUrlForCompanion(ref);
    if (!normalized) {
      return { ok: false, error: '参考图无法解析' };
    }
    inputImage = normalized;
  }

  if (preset.category === 'image_to_image' && !useImageRef && !forceTextToImage) {
    return { ok: false, error: '图生图需要上传参考分镜图，或改选文生图能力' };
  }

  const chunkLabel =
    args.chunkIndex != null ? `任务 ${args.chunkIndex + 1}` : `共 ${rows.length} 镜`;
  const label = preset.label || preset.id;
  ctx.onLog?.('info', `分镜表 · ${label} · ${chunkLabel} 生图中…`);

  const result = await executeCapability(preset, inputImage, ctx, {
    inputText,
    rejectTextTruncation: true,
  });
  if (!result.ok) {
    auditStoryboardGenFromCtx(ctx, 'sheet_gen', false, `分镜表 · ${chunkLabel} 生图失败：${result.error || '生图失败'}`, {
      taskId: args.chunkIndex != null ? `sheet_chunk_${args.chunkIndex}` : undefined,
      detail: { presetId: preset.id, shotCount: rows.length, chunkIndex: args.chunkIndex ?? null },
    });
    return { ok: false, error: result.error || '生图失败' };
  }
  if (result.kind !== 'image' || !String(result.image || '').trim()) {
    auditStoryboardGenFromCtx(ctx, 'sheet_gen', false, `分镜表 · ${chunkLabel} 生图失败：模型未返回有效图片`, {
      taskId: args.chunkIndex != null ? `sheet_chunk_${args.chunkIndex}` : undefined,
      detail: { presetId: preset.id, shotCount: rows.length, chunkIndex: args.chunkIndex ?? null },
    });
    return { ok: false, error: '模型未返回有效图片' };
  }

  ctx.onLog?.('info', `分镜表 · ${chunkLabel} 生图完成`);
  auditStoryboardGenFromCtx(ctx, 'sheet_gen', true, `分镜表 · ${chunkLabel} 生图完成`, {
    taskId: args.chunkIndex != null ? `sheet_chunk_${args.chunkIndex}` : undefined,
    detail: { presetId: preset.id, presetLabel: label, shotCount: rows.length, chunkIndex: args.chunkIndex ?? null },
  });
  return { ok: true, image: result.image };
}

export async function executeStoryboardSheetGenBatch(args: {
  preset: CustomAppModule;
  tasks: StoryboardSheetGenTask[];
  fieldCatalog: StoryboardParseFieldDef[];
  ctx: CapabilityExecuteContext;
  promptExtra?: string;
  referenceImageDataUrl?: string;
  forceTextToImage?: boolean;
  onTaskComplete?: (done: number, total: number) => void;
  onTaskStart?: (chunkIndex: number) => void;
  onChunkReady?: (result: StoryboardSheetGenChunkResult) => void | Promise<void>;
  concurrency?: number;
  controller?: StoryboardSheetGenBatchController;
}): Promise<StoryboardSheetGenBatchResult> {
  const concurrency = args.concurrency ?? STORYBOARD_SHEET_GEN_BATCH_CONCURRENCY;
  const total = args.tasks.length;
  let done = 0;
  const bumpDone = () => {
    done += 1;
    args.onTaskComplete?.(done, total);
  };

  const results = await mapLimit(
    args.tasks,
    concurrency,
    async (task): Promise<StoryboardSheetGenChunkResult> => {
      if (args.controller?.isCancelled(task.chunkIndex)) {
        const cancelled: StoryboardSheetGenChunkResult = {
          chunkIndex: task.chunkIndex,
          rowIds: task.rowIds,
          ok: false,
          error: '已取消',
          cancelled: true,
        };
        bumpDone();
        await args.onChunkReady?.(cancelled);
        return cancelled;
      }

      args.onTaskStart?.(task.chunkIndex);

      const outcome = await executeStoryboardSheetGen({
        preset: args.preset,
        rows: task.rows,
        fieldCatalog: args.fieldCatalog,
        ctx: args.ctx,
        promptExtra: args.promptExtra,
        referenceImageDataUrl: args.referenceImageDataUrl,
        forceTextToImage: args.forceTextToImage,
        chunkIndex: task.chunkIndex,
      });
      bumpDone();
      if (!outcome.ok) {
        const failed: StoryboardSheetGenChunkResult = {
          chunkIndex: task.chunkIndex,
          rowIds: task.rowIds,
          ok: false,
          error: outcome.error,
        };
        await args.onChunkReady?.(failed);
        return failed;
      }
      const ready: StoryboardSheetGenChunkResult = {
        chunkIndex: task.chunkIndex,
        rowIds: task.rowIds,
        ok: true,
        image: outcome.image,
      };
      await args.onChunkReady?.(ready);
      return ready;
    }
  );

  let okCount = 0;
  let failCount = 0;
  for (const item of results) {
    if (item.ok) okCount += 1;
    else failCount += 1;
  }

  return { tasks: args.tasks, results, okCount, failCount };
}

export type StoryboardSheetGenCompanionProbeReason = 'missing_config' | 'unreachable';

export type StoryboardSheetGenCompanionProbeResult =
  | { ok: true }
  | { ok: false; reason: StoryboardSheetGenCompanionProbeReason };

/** 拼图生成前检查本地伴侣是否可用（拼图预览落盘依赖伴侣） */
export async function probeStoryboardSheetGenCompanionReady(
  companionBaseUrl: string,
  companionProjectId: string
): Promise<StoryboardSheetGenCompanionProbeResult> {
  const base = String(companionBaseUrl || '').trim();
  const pid = String(companionProjectId || '').trim();
  if (!base || !pid) {
    return { ok: false, reason: 'missing_config' };
  }
  const health = await probeCompanionHealth(base);
  if (!health.ok) {
    return { ok: false, reason: 'unreachable' };
  }
  return { ok: true };
}

export function storyboardSheetGenCompanionProbeMessage(
  reason: StoryboardSheetGenCompanionProbeReason
): string {
  if (reason === 'unreachable') {
    return '本地伴侣不可达。请确认桌面伴侣已启动，并在设置中测试连接后再生成拼图。';
  }
  return '未连接本地伴侣或未打开工作区项目。拼图会保存到本地伴侣，请先在侧栏连接伴侣并进入项目后再生成。';
}
