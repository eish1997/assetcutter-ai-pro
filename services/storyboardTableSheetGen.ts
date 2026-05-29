import type { CustomAppModule, StoryboardParseFieldDef, StoryboardTableRow } from '../types';
import { applyStoryboardBulkImport, parseStoryboardBulkText, type StoryboardBulkTextMode } from './storyboardTableBulkImport';
import { buildStoryboardRowPromptText } from './storyboardTableRedraw';
import { compileRedrawPrompt } from './storyboardTableParse';
import {
  capabilityUsesGenImageEngine,
  executeCapability,
  getCapabilityEngine,
  type CapabilityExecuteContext,
} from './capabilityExecutor';
import { imageSrcToDataUrlForCompanion } from './workflowCompanionAssets';

export const STORYBOARD_SHEET_SHOTS_PER_IMAGE_KEY = 'ac_storyboard_sheet_shots_per_image_v1';
export const STORYBOARD_SHEET_GEN_EXTRA_PROMPT_KEY = 'ac_storyboard_sheet_gen_extra_prompt_v1';
export const STORYBOARD_SHEET_GEN_BATCH_CONCURRENCY = 2;

export const STORYBOARD_SHEET_SHOTS_PER_IMAGE_OPTIONS = [4, 6, 9, 12, 16, 20, 25, 30, 36] as const;

export type StoryboardSheetGenBatchRequest = {
  presetId: string;
  shotsPerSheet: number;
  promptExtra: string;
  referenceImageDataUrl?: string;
  sourceRows: StoryboardTableRow[];
  fieldCatalog: StoryboardParseFieldDef[];
};

export type StoryboardSheetGenTask = {
  chunkIndex: number;
  rows: StoryboardTableRow[];
  rowIds: string[];
};

export type StoryboardSheetGenChunkResult =
  | { chunkIndex: number; rowIds: string[]; ok: true; image: string }
  | { chunkIndex: number; rowIds: string[]; ok: false; error: string };

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
  return Boolean(buildStoryboardRowPromptText(row, catalog).trim());
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

  rows.forEach((row, index) => {
    const body = compileRedrawPrompt(row, catalog).trim();
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
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await mapper(items[i]!, i);
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
  const { preset, rows, fieldCatalog, ctx, promptExtra, referenceImageDataUrl, forceTextToImage } = args;

  if (getCapabilityEngine(preset) !== 'gen_image') {
    return { ok: false, error: '请选择文生图或图生图类能力' };
  }
  if (!rows.length) {
    return { ok: false, error: '本任务没有可用镜头' };
  }

  const inputText = compileSheetRedrawPrompt(rows, fieldCatalog, { promptExtra });
  if (!inputText) {
    return { ok: false, error: '请先填写或导入分镜内容' };
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

  const result = await executeCapability(preset, inputImage, ctx, { inputText });
  if (!result.ok) {
    return { ok: false, error: result.error || '生图失败' };
  }
  if (result.kind !== 'image' || !String(result.image || '').trim()) {
    return { ok: false, error: '模型未返回有效图片' };
  }

  ctx.onLog?.('info', `分镜表 · ${chunkLabel} 生图完成`);
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
  concurrency?: number;
}): Promise<StoryboardSheetGenBatchResult> {
  const concurrency = args.concurrency ?? STORYBOARD_SHEET_GEN_BATCH_CONCURRENCY;
  const total = args.tasks.length;
  let done = 0;
  const results = await mapLimit(args.tasks, concurrency, async (task): Promise<StoryboardSheetGenChunkResult> => {
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
    done += 1;
    args.onTaskComplete?.(done, total);
    if (!outcome.ok) {
      return { chunkIndex: task.chunkIndex, rowIds: task.rowIds, ok: false, error: outcome.error };
    }
    return { chunkIndex: task.chunkIndex, rowIds: task.rowIds, ok: true, image: outcome.image };
  });

  let okCount = 0;
  let failCount = 0;
  for (const item of results) {
    if (item.ok) okCount += 1;
    else failCount += 1;
  }

  return { tasks: args.tasks, results, okCount, failCount };
}
