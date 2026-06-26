import type { CustomAppModule, StoryboardParseFieldDef, StoryboardTableRow } from '../types';
import { formatStoryboardShotNo } from './storyboardTableAsset';
import { coerceImageModelRegistryId } from './modelRegistry/imageModels';
import {
  capabilityUsesGenImageEngine,
  executeCapability,
  getCapabilityEngine,
  type CapabilityExecuteContext,
} from './capabilityExecutor';
import { auditStoryboardGenFromCtx, resolveStoryboardCollageAuditOperation, type StoryboardTaskOperation } from './storyboardTaskAuditEvents';
import {
  computeStoryboardMosaicGrid,
  type StoryboardGroupMosaicRenderOpts,
} from './storyboardFrameStripMerge';
import {
  drawFeedbackCollageImageOnlyCell,
  measureFeedbackCollageImageDrawRect,
  measureFeedbackCollageImageOnlyRects,
} from './storyboardCompositeFrameRender';
import { pixelRectToNormBox, type FeedbackCollageLayout } from './storyboardFeedbackCollageSplit';
import { resolveStoryboardRowFrameAspectRatio } from './storyboardFrameAspect';
export type { FeedbackCollageLayout, FeedbackCollageLayoutCell } from './storyboardFeedbackCollageSplit';
export {
  splitStoryboardFeedbackCollageByLayout,
  splitStoryboardFeedbackCollageWithBoxes,
  feedbackCollageLayoutToBoxes,
  feedbackCollageLayoutToManualAdjustBoxes,
  pixelRectToNormBox,
} from './storyboardFeedbackCollageSplit';
import {
  chunkStoryboardRowsByCount,
  type StoryboardSheetGenTask,
} from './storyboardTableSheetGen';
import {
  resolveStoryboardFeedbackCollagePreset,
  isStoryboardFeedbackRedrawEligible,
  listStoryboardFeedbackRedrawRows,
  DEFAULT_STORYBOARD_FEEDBACK_COLLAGE_INSTRUCTION,
} from './storyboardTableRedraw';
import type { SheetCellTextMeta } from './storyboardSheetCellTypography';
import {
  STORYBOARD_SHEET_SKETCH_BG,
  ensureStoryboardSheetSketchFontLoaded,
} from './storyboardSheetSketchStyle';

export const STORYBOARD_EDIT_FEEDBACK_COLLAGE_LIMIT_KEY = 'ac_storyboard_edit_feedback_collage_limit_v1';
export const STORYBOARD_FEEDBACK_COLLAGE_LIMIT_DEFAULT = 9;
export const STORYBOARD_FEEDBACK_COLLAGE_LIMIT_MAX = 48;
export const STORYBOARD_FEEDBACK_COLLAGE_LIMIT_OPTIONS = [4, 6, 9, 12, 16, 20] as const;
export const STORYBOARD_FEEDBACK_COLLAGE_LIMIT_CUSTOM_OPTION = '__custom__';

export function isStoryboardFeedbackCollageLimitPreset(value: number): boolean {
  return (STORYBOARD_FEEDBACK_COLLAGE_LIMIT_OPTIONS as readonly number[]).includes(value);
}

export type StoryboardFeedbackRedrawBatchRecord = {
  id: string;
  createdAt: number;
  label: string;
  rowIds: string[];
  status: 'running' | 'done' | 'partial' | 'failed';
  matchedCount?: number;
  totalTasks?: number;
  /** 该批次切分回填后的各镜预览图（rowId → data URL） */
  rowImages?: Record<string, string>;
};

export function normalizeFeedbackCollageLimit(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return STORYBOARD_FEEDBACK_COLLAGE_LIMIT_DEFAULT;
  return Math.min(
    STORYBOARD_FEEDBACK_COLLAGE_LIMIT_MAX,
    Math.max(1, Math.round(n))
  );
}

export function compileFeedbackSheetShotPanelMeta(row: StoryboardTableRow): SheetCellTextMeta {
  const shotNo = (row.shotNo || '').trim() || `镜头 ${row.index + 1}`;
  return {
    headerLine: shotNo,
    visualLine: '',
    dialogueLine: '-',
    compactLayout: {
      headerLine: shotNo,
      metaLine: '',
      description: '',
      extraLines: [],
    },
  };
}

/** @deprecated 拼图改图统一为仅修改反馈 */
export type StoryboardCollageRedrawMode = 'feedback';

export function compileStoryboardCollageRedrawPrompt(rows: StoryboardTableRow[]): string {
  return compileStoryboardFeedbackSheetPrompt(rows);
}

/** 仅含拼图格位与修改反馈，不含分镜表结构化文本 */
export function compileStoryboardFeedbackSheetPrompt(rows: StoryboardTableRow[]): string {
  const { cols, rows: gridRows } = computeStoryboardMosaicGrid(rows.length);
  const parts = [
    rows.length === 1
      ? '输入为当前镜头分镜图。'
      : `输入为多格拼图（约 ${cols} 列 × ${gridRows} 行，共 ${rows.length} 格，从左到右、从上到下）。`,
    '按下列修改反馈调整画面；画风、线稿/上色方式须与输入图保持一致。',
  ];

  rows.forEach((row, index) => {
    const feedback = (row.editFeedback ?? '').trim();
    if (!feedback) return;
    const label = row.shotNo?.trim() || String(index + 1);
    parts.push(rows.length === 1 ? feedback : `格 ${label}：${feedback}`);
  });

  return parts.join('\n');
}

export type StoryboardFeedbackCollageRenderResult = {
  dataUrl: string;
  layout: FeedbackCollageLayout;
};

/** 将多镜分镜图 + 修改反馈拼成一张 contact sheet（供图生图改图） */
export async function renderStoryboardFeedbackCollage(
  rows: StoryboardTableRow[],
  fieldCatalog: StoryboardParseFieldDef[] = [],
  opts: StoryboardGroupMosaicRenderOpts = {}
): Promise<StoryboardFeedbackCollageRenderResult | null> {
  if (typeof document === 'undefined' || rows.length === 0) return null;

  await ensureStoryboardSheetSketchFontLoaded();

  const width = Math.max(320, Math.round(opts.width ?? 960));
  const jpegQuality = opts.jpegQuality ?? 0.92;
  const scale = width / 960;
  const { cols, rows: gridRows } = computeStoryboardMosaicGrid(rows.length);
  const pad = Math.max(4, Math.round(6 * scale));
  const gap = Math.max(2, Math.round(4 * scale));
  const innerW = width - pad * 2;
  const cellW = cols > 0 ? (innerW - gap * (cols - 1)) / cols : innerW;
  const cellH = Math.round(cellW * 0.75);
  const innerH = gridRows * cellH + Math.max(0, gridRows - 1) * gap;
  const height = Math.max(240, Math.round(innerH + pad * 2));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = STORYBOARD_SHEET_SKETCH_BG;
  ctx.fillRect(0, 0, width, height);

  const layoutCells: FeedbackCollageLayout['cells'] = [];
  let y = pad;
  for (let rowIdx = 0; rowIdx < gridRows; rowIdx += 1) {
    for (let col = 0; col < cols; col += 1) {
      const index = rowIdx * cols + col;
      if (index >= rows.length) break;
      const row = rows[index]!;
      const x = pad + col * (cellW + gap);
      const shotNo = (row.shotNo || '').trim() || formatStoryboardShotNo(index);
      const { visualRect } = measureFeedbackCollageImageOnlyRects(x, y, cellW, cellH);
      const drawRect = await measureFeedbackCollageImageDrawRect(row, visualRect);
      layoutCells.push({
        rowId: row.id,
        shotNo,
        imageBox: pixelRectToNormBox(drawRect, width, height),
      });
      await drawFeedbackCollageImageOnlyCell(ctx, row, x, y, cellW, cellH, shotNo);
    }
    y += cellH + gap;
  }

  try {
    const dataUrl = canvas.toDataURL('image/jpeg', jpegQuality);
    return {
      dataUrl,
      layout: { width, height, cells: layoutCells },
    };
  } catch {
    return null;
  }
}

/** @deprecated 使用 renderStoryboardFeedbackCollage */
export async function renderStoryboardFeedbackCollageDataUrl(
  rows: StoryboardTableRow[],
  fieldCatalog: StoryboardParseFieldDef[] = [],
  opts: StoryboardGroupMosaicRenderOpts = {}
): Promise<string | null> {
  const rendered = await renderStoryboardFeedbackCollage(rows, fieldCatalog, opts);
  return rendered?.dataUrl ?? null;
}

export function planStoryboardFeedbackRedrawTasks(
  rows: StoryboardTableRow[],
  collageLimit: number
): StoryboardSheetGenTask[] {
  const eligible = rows.filter(isStoryboardFeedbackRedrawEligible);
  const chunks = chunkStoryboardRowsByCount(eligible, collageLimit);
  return chunks.map((chunkRows, chunkIndex) => ({
    chunkIndex,
    rows: chunkRows,
    rowIds: chunkRows.map((row) => row.id),
  }));
}

export function formatStoryboardFeedbackBatchLabel(
  createdAt: number,
  shotCount: number
): string {
  const d = new Date(createdAt);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm} · ${shotCount}镜`;
}

export function listStoryboardFeedbackRedrawEligibleRows(rows: StoryboardTableRow[]): StoryboardTableRow[] {
  return listStoryboardFeedbackRedrawRows(rows).filter(isStoryboardFeedbackRedrawEligible);
}

export type StoryboardCollageRedrawArgs = {
  preset: CustomAppModule;
  rows: StoryboardTableRow[];
  fieldCatalog: StoryboardParseFieldDef[];
  ctx: CapabilityExecuteContext;
  imageModelRegistryId?: string;
  understand?: boolean;
  chunkIndex?: number;
  /** @deprecated 已统一为仅修改反馈 */
  mode?: StoryboardCollageRedrawMode;
  companionBaseUrl?: string;
  companionProjectId?: string;
  /** 审计：反馈批量/单行反馈改图（默认由 executeStoryboardFeedbackSheetRedraw 设为 true） */
  feedbackRedraw?: boolean;
  /** 审计：显式指定 operation（优先于 feedbackRedraw / rowCount 推断） */
  auditOperation?: StoryboardTaskOperation;
};

/** @deprecated 使用 StoryboardCollageRedrawArgs */
export type StoryboardFeedbackSheetRedrawArgs = StoryboardCollageRedrawArgs;

function collageRedrawChunkLabel(rows: StoryboardTableRow[], chunkIndex?: number): string {
  if (rows.length === 1) {
    const row = rows[0]!;
    return `镜头 ${row.shotNo || row.index + 1} 拼图改图`;
  }
  return chunkIndex != null ? `拼图改图 ${chunkIndex + 1}` : `拼图改图 ${rows.length} 镜`;
}

export async function executeStoryboardCollageRedraw(
  args: StoryboardCollageRedrawArgs
): Promise<
  { ok: true; image: string; layout: FeedbackCollageLayout } | { ok: false; error: string }
> {
  const { rows, fieldCatalog, ctx, understand = true } = args;

  if (getCapabilityEngine(args.preset) !== 'gen_image') {
    return { ok: false, error: '请选择图生图类能力' };
  }
  if (!capabilityUsesGenImageEngine(args.preset)) {
    return { ok: false, error: '当前能力不支持生图' };
  }
  if (!rows.length) {
    return { ok: false, error: '本任务没有可用镜头' };
  }

  const collage = await renderStoryboardFeedbackCollage(rows, fieldCatalog);
  if (!collage) {
    return { ok: false, error: '拼图失败，请确认各镜已有分镜图' };
  }

  const inputText = compileStoryboardCollageRedrawPrompt(rows);
  if (!inputText) {
    return { ok: false, error: '请先填写修改反馈' };
  }

  const presetBase =
    args.imageModelRegistryId != null && String(args.imageModelRegistryId).trim()
      ? {
          ...args.preset,
          imageModelRegistryId: coerceImageModelRegistryId(args.imageModelRegistryId),
        }
      : args.preset;

  const aspectRow = rows[0];
  const aspectRatio = aspectRow
    ? await resolveStoryboardRowFrameAspectRatio(aspectRow, {
        companionBaseUrl: args.companionBaseUrl,
        companionProjectId: args.companionProjectId ?? args.ctx.companionProjectId,
      })
    : undefined;

  const preset: CustomAppModule = {
    ...presetBase,
    category: 'image_to_image',
    instruction:
      (presetBase.instruction || '').trim() || DEFAULT_STORYBOARD_FEEDBACK_COLLAGE_INSTRUCTION,
    skipUnderstand: !understand,
    ...(aspectRatio ? { imageAspectRatio: aspectRatio } : {}),
  };

  const chunkLabel = collageRedrawChunkLabel(rows, args.chunkIndex);
  const label = preset.label || preset.id;
  ctx.onLog?.('info', `分镜表 · ${label} · ${chunkLabel} 改图中…`);

  const result = await executeCapability(preset, collage.dataUrl, ctx, { inputText });
  const operation = resolveStoryboardCollageAuditOperation({
    auditOperation: args.auditOperation,
    feedbackRedraw: args.feedbackRedraw,
    rowCount: rows.length,
  });
  if (!result.ok) {
    auditStoryboardGenFromCtx(ctx, operation, false, `分镜表 · ${chunkLabel} 改图失败：${result.error || '改图失败'}`, {
      taskId: args.chunkIndex != null ? `collage_chunk_${args.chunkIndex}` : undefined,
      detail: { presetId: preset.id, rowIds: rows.map((r) => r.id), chunkIndex: args.chunkIndex ?? null },
    });
    return { ok: false, error: result.error || '改图失败' };
  }
  if (result.kind !== 'image' || !String(result.image || '').trim()) {
    auditStoryboardGenFromCtx(ctx, operation, false, `分镜表 · ${chunkLabel} 改图失败：模型未返回有效图片`, {
      taskId: args.chunkIndex != null ? `collage_chunk_${args.chunkIndex}` : undefined,
      detail: { presetId: preset.id, rowIds: rows.map((r) => r.id), chunkIndex: args.chunkIndex ?? null },
    });
    return { ok: false, error: '模型未返回有效图片' };
  }

  ctx.onLog?.('info', `分镜表 · ${chunkLabel} 改图完成`);
  auditStoryboardGenFromCtx(ctx, operation, true, `分镜表 · ${chunkLabel} 改图完成`, {
    taskId: args.chunkIndex != null ? `collage_chunk_${args.chunkIndex}` : undefined,
    detail: { presetId: preset.id, presetLabel: label, rowIds: rows.map((r) => r.id), chunkIndex: args.chunkIndex ?? null },
  });
  return { ok: true, image: result.image, layout: collage.layout };
}

export async function executeStoryboardFeedbackSheetRedraw(
  args: StoryboardCollageRedrawArgs
): Promise<
  { ok: true; image: string; layout: FeedbackCollageLayout } | { ok: false; error: string }
> {
  return executeStoryboardCollageRedraw({
    ...args,
    feedbackRedraw: args.feedbackRedraw ?? true,
    auditOperation: args.auditOperation ?? 'feedback_redraw',
  });
}

export function pickFeedbackSheetRedrawPreset(
  presets: CustomAppModule[],
  presetId?: string | null
): CustomAppModule | null {
  return resolveStoryboardFeedbackCollagePreset(presets, presetId);
}
