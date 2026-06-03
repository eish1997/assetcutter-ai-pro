import type {
  StoryboardFrameRoleMark,
  StoryboardRoleAsset,
  StoryboardTableRow,
  StoryboardParseFieldDef,
} from '../types';
import type { CustomAppModule } from '../types';
import { coerceImageModelRegistryId } from './modelRegistry/imageModels';
import {
  capabilityUsesGenImageEngine,
  executeCapability,
  getCapabilityEngine,
  type CapabilityExecuteContext,
} from './capabilityExecutor';
import { chunkStoryboardRowsByCount, type StoryboardSheetGenTask } from './storyboardTableSheetGen';
import { computeStoryboardMosaicGrid } from './storyboardFrameStripMerge';
import {
  renderStoryboardFeedbackCollage,
  type StoryboardFeedbackCollageRenderResult,
} from './storyboardFeedbackSheetRedraw';
import type { FeedbackCollageLayout } from './storyboardFeedbackCollageSplit';
import { storyboardRowHasFrameRef } from './storyboardFrameImageUrl';
import { resolveStoryboardRowFrameAspectRatio } from './storyboardFrameAspect';
import {
  resolveStoryboardRowFrameDataUrl,
  type StoryboardRowRedrawResult,
} from './storyboardTableRedraw';
import {
  resolveStoryboardNamedAssetImageDataUrl,
  storyboardNamedAssetHasImageRef,
} from './storyboardNamedAssetImage';
import { isStoryboardRoleReplaceEligible } from './storyboardEditEligibility';

export { isStoryboardRoleReplaceEligible };

export const STORYBOARD_ROLE_REPLACE_DEFAULT_PRESET_ID = 'storyboard_role_replace_v1';
export const DEFAULT_STORYBOARD_ROLE_REPLACE_INSTRUCTION = `你是分镜角色替换助手（多图参考，无需阅读任何分镜文字）。

参考图 1：当前镜头分镜图（画风、构图、姿态、表情、动作的唯一样板）。
参考图 2 起：角色资产参考图（仅提供被替换人物的外貌/造型）。

按用户消息中的位置清单，把参考图 1 里对应位置的人物外貌换成相应参考图的角色造型；姿态、表情、动作、景别、背景与整体画风必须与参考图 1 一致。未列入清单的区域不要改动。

禁止：改动作/表情、重绘场景、添加文字或边框、输出多格画面。`;

export type StoryboardRoleReplaceMarkPlan = {
  mark: StoryboardFrameRoleMark;
  asset: StoryboardRoleAsset;
  assetImage: string;
  /** 在 referenceImages 中的序号（0 为原始分镜图） */
  refIndex: number;
};

export type StoryboardRoleReplacePlan = {
  marks: StoryboardRoleReplaceMarkPlan[];
  referenceImages: string[];
};

export function getBuiltinStoryboardRoleReplacePreset(): CustomAppModule {
  return {
    id: STORYBOARD_ROLE_REPLACE_DEFAULT_PRESET_ID,
    label: '分镜角色替换改图',
    category: 'image_to_image',
    engine: 'gen_image',
    enabled: true,
    instruction: DEFAULT_STORYBOARD_ROLE_REPLACE_INSTRUCTION,
    imageGear: 'pro',
  };
}

export function resolveRoleAssetForMark(
  mark: StoryboardFrameRoleMark,
  roleAssets: StoryboardRoleAsset[]
): StoryboardRoleAsset | null {
  const roleAssetId = String(mark.roleAssetId || '').trim();
  if (roleAssetId) {
    const byId = roleAssets.find((asset) => asset.id === roleAssetId);
    if (byId) return byId;
  }
  const name = String(mark.name || '').trim();
  if (!name) return null;
  return roleAssets.find((asset) => asset.name.trim() === name) ?? null;
}

function resolveRoleMarkDisplayName(
  mark: StoryboardFrameRoleMark,
  roleAssets: StoryboardRoleAsset[]
): string {
  const asset = resolveRoleAssetForMark(mark, roleAssets);
  const fromAsset = asset?.name.trim();
  if (fromAsset) return fromAsset;
  return String(mark.name || '').trim();
}

export function listStoryboardRoleReplaceEligibleRows(
  rows: StoryboardTableRow[],
  roleAssets: StoryboardRoleAsset[]
): StoryboardTableRow[] {
  return rows.filter((row) => isStoryboardRoleReplaceEligible(row, roleAssets));
}

/** 按每批镜头上限拆分拼图角色替换任务 */
export function planStoryboardRoleReplaceTasks(
  rows: StoryboardTableRow[],
  roleAssets: StoryboardRoleAsset[],
  collageLimit: number
): StoryboardSheetGenTask[] {
  const eligible = listStoryboardRoleReplaceEligibleRows(rows, roleAssets);
  const chunks = chunkStoryboardRowsByCount(eligible, collageLimit);
  return chunks.map((chunkRows, chunkIndex) => ({
    chunkIndex,
    rows: chunkRows,
    rowIds: chunkRows.map((row) => row.id),
  }));
}

function formatRoleReplacePosition(mark: StoryboardFrameRoleMark): string {
  const x = Math.round(mark.x * 100);
  const y = Math.round(mark.y * 100);
  return `横向约 ${x}%、纵向约 ${y}%`;
}

function compileStoryboardRoleReplaceMarkLines(
  markPlans: StoryboardRoleReplaceMarkPlan[],
  refIndexOffset: number
): string[] {
  return markPlans.map((item) => {
    const pos = formatRoleReplacePosition(item.mark);
    const name = String(item.asset.name || item.mark.name || '').trim() || '角色';
    return `- 画面 ${pos} → 参考图 ${item.refIndex + refIndexOffset}（${name}）`;
  });
}

/** 单镜多图参考：参考图 1 = 原分镜图 */
export function compileStoryboardRoleReplacePrompt(plan: StoryboardRoleReplacePlan): string {
  const replaceLines = compileStoryboardRoleReplaceMarkLines(plan.marks, 1);
  return [
    '将参考图 1（当前分镜图）中下列位置的人物，替换为对应参考图的角色资产外貌；画风、构图、姿态、表情、动作与参考图 1 保持一致。',
    '',
    ...replaceLines,
  ].join('\n');
}

function compileStoryboardRoleReplaceCollageMarkLines(
  markPlans: StoryboardRoleReplaceMarkPlan[],
  refIndexOffset: number
): string[] {
  return markPlans.map((item) => {
    const pos = formatRoleReplacePosition(item.mark);
    const name = String(item.asset.name || item.mark.name || '').trim() || '角色';
    return `- 格内画面 ${pos} → 参考图 ${item.refIndex + refIndexOffset}（${name}）`;
  });
}

/** 拼图批处理：参考图 1 = 拼图，2+ = 角色资产 */
export function compileStoryboardRoleReplaceCollageSheetPrompt(
  rows: StoryboardTableRow[],
  rowMarkPlans: Map<string, StoryboardRoleReplaceMarkPlan[]>
): string {
  const { cols, rows: gridRows } = computeStoryboardMosaicGrid(rows.length);
  const parts = [
    rows.length === 1
      ? '输入为当前镜头分镜拼图（参考图 1）。'
      : `输入为多格拼图（约 ${cols} 列 × ${gridRows} 行，共 ${rows.length} 格，从左到右、从上到下；参考图 1）。`,
    '参考图 2 起为角色资产。在各格内按下列位置替换人物外貌；画风、构图、姿态、表情、动作须与该格原图一致。未列入清单的格位与区域不要改动。',
  ];

  rows.forEach((row) => {
    const marks = rowMarkPlans.get(row.id) ?? [];
    if (!marks.length) return;
    const label = row.shotNo?.trim() || String(row.index + 1);
    const lines = compileStoryboardRoleReplaceCollageMarkLines(marks, 2);
    if (rows.length === 1) {
      parts.push('', ...lines);
    } else {
      parts.push('', `格 ${label}：`, ...lines);
    }
  });

  return parts.join('\n');
}

export async function planStoryboardRoleReplaceChunkReferences(
  rows: StoryboardTableRow[],
  roleAssets: StoryboardRoleAsset[],
  companion?: { companionBaseUrl?: string; companionProjectId?: string }
): Promise<
  | { ok: true; rowMarkPlans: Map<string, StoryboardRoleReplaceMarkPlan[]>; referenceImages: string[] }
  | { ok: false; error: string }
> {
  const referenceImages: string[] = [];
  const imageKeyToRefIndex = new Map<string, number>();
  const rowMarkPlans = new Map<string, StoryboardRoleReplaceMarkPlan[]>();

  for (const row of rows) {
    const appended = await appendRowMarksToChunkRefs(
      row,
      roleAssets,
      referenceImages,
      imageKeyToRefIndex,
      rowMarkPlans,
      companion
    );
    if (!appended.ok) return appended;
    if (!(rowMarkPlans.get(row.id)?.length ?? 0)) {
      const shot = row.shotNo?.trim() || `镜头 ${row.index + 1}`;
      return { ok: false, error: `${shot} 没有可替换的角色标注` };
    }
  }

  return { ok: true, rowMarkPlans, referenceImages };
}

async function resolveRoleAssetImage(
  asset: StoryboardRoleAsset,
  opts?: { companionBaseUrl?: string; companionProjectId?: string }
): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string }> {
  return resolveStoryboardNamedAssetImageDataUrl(asset, opts);
}

async function appendRowMarksToChunkRefs(
  row: StoryboardTableRow,
  roleAssets: StoryboardRoleAsset[],
  referenceImages: string[],
  imageKeyToRefIndex: Map<string, number>,
  rowMarkPlans: Map<string, StoryboardRoleReplaceMarkPlan[]>,
  companion?: { companionBaseUrl?: string; companionProjectId?: string }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const marks = row.frameRoleMarks ?? [];
  const plannedMarks: StoryboardRoleReplaceMarkPlan[] = [];

  for (const mark of marks) {
    const asset = resolveRoleAssetForMark(mark, roleAssets);
    const name = resolveRoleMarkDisplayName(mark, roleAssets);
    if (!name) {
      return { ok: false, error: '存在未填写名称的角色标注，请先补全角色名' };
    }
    if (!asset) {
      return { ok: false, error: `角色「${name}」未找到对应资产，请先在解析页添加` };
    }
    const resolved = await resolveRoleAssetImage(asset, companion);
    if (!resolved.ok) {
      return { ok: false, error: `角色「${name}」${resolved.error}` };
    }
    const assetImage = resolved.dataUrl;

    let refIndex = imageKeyToRefIndex.get(assetImage);
    if (refIndex == null) {
      refIndex = referenceImages.length;
      referenceImages.push(assetImage);
      imageKeyToRefIndex.set(assetImage, refIndex);
    }

    plannedMarks.push({ mark, asset, assetImage, refIndex });
  }

  if (plannedMarks.length) {
    rowMarkPlans.set(row.id, plannedMarks);
  }
  return { ok: true };
}

async function buildStoryboardRoleReplacePlanFromFrame(
  frameDataUrl: string,
  row: StoryboardTableRow,
  roleAssets: StoryboardRoleAsset[],
  companion?: { companionBaseUrl?: string; companionProjectId?: string }
): Promise<{ ok: true; plan: StoryboardRoleReplacePlan } | { ok: false; error: string }> {
  const referenceImages: string[] = [frameDataUrl];
  const imageKeyToRefIndex = new Map<string, number>();
  const rowMarkPlans = new Map<string, StoryboardRoleReplaceMarkPlan[]>();

  const appended = await appendRowMarksToChunkRefs(
    row,
    roleAssets,
    referenceImages,
    imageKeyToRefIndex,
    rowMarkPlans,
    companion
  );
  if (!appended.ok) return appended;

  const marks = rowMarkPlans.get(row.id) ?? [];
  if (!marks.length) {
    return { ok: false, error: '本镜没有可替换的角色标注' };
  }

  return { ok: true, plan: { marks, referenceImages } };
}

export async function planStoryboardRoleReplace(
  row: StoryboardTableRow,
  roleAssets: StoryboardRoleAsset[],
  companion?: {
    companionBaseUrl?: string;
    companionProjectId?: string;
    /** 已解析的分镜图 data URL（测试或调用方预加载时传入） */
    frameDataUrl?: string;
  }
): Promise<{ ok: true; plan: StoryboardRoleReplacePlan } | { ok: false; error: string }> {
  if (!storyboardRowHasFrameRef(row)) {
    return { ok: false, error: '当前镜头没有分镜图' };
  }
  const presetFrame = String(companion?.frameDataUrl || '').trim();
  if (presetFrame) {
    return buildStoryboardRoleReplacePlanFromFrame(presetFrame, row, roleAssets, companion);
  }
  const frame = await resolveStoryboardRowFrameDataUrl(
    row,
    companion?.companionBaseUrl ?? '',
    companion?.companionProjectId ?? ''
  );
  if (!frame.ok) return frame;
  return buildStoryboardRoleReplacePlanFromFrame(frame.dataUrl, row, roleAssets, companion);
}

export type StoryboardRoleReplaceRedrawArgs = {
  preset: CustomAppModule;
  row: StoryboardTableRow;
  roleAssets: StoryboardRoleAsset[];
  fieldCatalog: StoryboardParseFieldDef[];
  ctx: CapabilityExecuteContext;
  imageModelRegistryId?: string;
  understand?: boolean;
  companionBaseUrl?: string;
  companionProjectId?: string;
};

export type StoryboardRoleReplaceCollageBatchArgs = {
  preset: CustomAppModule;
  rows: StoryboardTableRow[];
  roleAssets: StoryboardRoleAsset[];
  fieldCatalog: StoryboardParseFieldDef[];
  ctx: CapabilityExecuteContext;
  imageModelRegistryId?: string;
  understand?: boolean;
  chunkIndex?: number;
  companionBaseUrl?: string;
  companionProjectId?: string;
};

function buildRoleReplacePreset(
  presetBase: CustomAppModule,
  imageModelRegistryId: string | undefined,
  understand: boolean
): CustomAppModule {
  const withModel =
    imageModelRegistryId != null && String(imageModelRegistryId).trim()
      ? {
          ...presetBase,
          imageModelRegistryId: coerceImageModelRegistryId(imageModelRegistryId),
        }
      : presetBase;

  return {
    ...withModel,
    category: 'image_to_image',
    skipUnderstand: !understand,
  };
}

/** 单镜：参考图 1 = 原始分镜图，参考图 2+ = 角色资产，多图参考生图 */
export async function executeStoryboardRoleReplaceRow(
  args: StoryboardRoleReplaceRedrawArgs
): Promise<StoryboardRowRedrawResult> {
  const { row, roleAssets, ctx, understand = true } = args;

  if (getCapabilityEngine(args.preset) !== 'gen_image') {
    return { ok: false, error: '请选择图生图类能力' };
  }
  if (!capabilityUsesGenImageEngine(args.preset)) {
    return { ok: false, error: '当前能力不支持生图' };
  }
  if (!isStoryboardRoleReplaceEligible(row, roleAssets)) {
    return { ok: false, error: `镜头 ${row.shotNo || row.index + 1} 不满足角色替换条件` };
  }

  const companion = {
    companionBaseUrl: args.companionBaseUrl,
    companionProjectId: args.companionProjectId ?? args.ctx.companionProjectId,
  };
  const planned = await planStoryboardRoleReplace(row, roleAssets, companion);
  if (!planned.ok) {
    return { ok: false, error: planned.error };
  }

  const inputText = compileStoryboardRoleReplacePrompt(planned.plan);
  if (!inputText) {
    return { ok: false, error: '未能生成角色替换说明' };
  }

  const aspectRatio = await resolveStoryboardRowFrameAspectRatio(row, {
    companionBaseUrl: args.companionBaseUrl,
    companionProjectId: args.companionProjectId ?? args.ctx.companionProjectId,
    frameDataUrl: planned.plan.referenceImages[0],
  });
  const presetBase = buildRoleReplacePreset(args.preset, args.imageModelRegistryId, understand);
  const preset: CustomAppModule = {
    ...presetBase,
    ...(aspectRatio ? { imageAspectRatio: aspectRatio } : {}),
  };
  const shotLabel = row.shotNo?.trim() || `镜头 ${row.index + 1}`;
  const label = preset.label || preset.id;
  const refCount = planned.plan.referenceImages.length;
  ctx.onLog?.('info', `分镜表 · ${label} · ${shotLabel} 多图参考替换（${refCount} 张）…`);

  const result = await executeCapability(preset, planned.plan.referenceImages[0]!, ctx, {
    inputText,
    inputImages: planned.plan.referenceImages,
    rejectTextTruncation: true,
  });

  if (!result.ok) {
    return { ok: false, error: result.error || '角色替换失败' };
  }
  if (result.kind !== 'image' || !String(result.image || '').trim()) {
    return { ok: false, error: '模型未返回有效图片' };
  }

  ctx.onLog?.('info', `分镜表 · ${shotLabel} 角色替换完成`);
  return { ok: true, image: result.image };
}

function roleReplaceCollageChunkLabel(rows: StoryboardTableRow[], chunkIndex?: number): string {
  if (rows.length === 1) {
    const row = rows[0]!;
    return `镜头 ${row.shotNo || row.index + 1} 拼图替换`;
  }
  return chunkIndex != null ? `拼图替换 ${chunkIndex + 1}` : `拼图替换 ${rows.length} 镜`;
}

/** 批量：多镜拼 contact sheet → 多图参考生图 → 切分回填 */
export async function executeStoryboardRoleReplaceCollageBatch(
  args: StoryboardRoleReplaceCollageBatchArgs
): Promise<
  | { ok: true; image: string; layout: FeedbackCollageLayout; rowIds: string[] }
  | { ok: false; error: string }
> {
  const { rows, roleAssets, fieldCatalog, ctx, understand = true } = args;

  if (getCapabilityEngine(args.preset) !== 'gen_image') {
    return { ok: false, error: '请选择图生图类能力' };
  }
  if (!capabilityUsesGenImageEngine(args.preset)) {
    return { ok: false, error: '当前能力不支持生图' };
  }
  if (!rows.length) {
    return { ok: false, error: '本任务没有可用镜头' };
  }

  const companion = {
    companionBaseUrl: args.companionBaseUrl,
    companionProjectId: args.companionProjectId ?? args.ctx.companionProjectId,
  };

  const chunkRefs = await planStoryboardRoleReplaceChunkReferences(rows, roleAssets, companion);
  if (!chunkRefs.ok) {
    return { ok: false, error: chunkRefs.error };
  }

  let collage: StoryboardFeedbackCollageRenderResult | null = null;
  try {
    collage = await renderStoryboardFeedbackCollage(rows, fieldCatalog);
  } catch {
    collage = null;
  }
  if (!collage) {
    return { ok: false, error: '拼图失败，请确认各镜已有分镜图' };
  }

  const inputText = compileStoryboardRoleReplaceCollageSheetPrompt(rows, chunkRefs.rowMarkPlans);
  if (!inputText.trim()) {
    return { ok: false, error: '未能生成角色替换说明' };
  }

  const referenceImages = [collage.dataUrl, ...chunkRefs.referenceImages];
  const aspectRow = rows[0];
  const aspectRatio = aspectRow
    ? await resolveStoryboardRowFrameAspectRatio(aspectRow, companion)
    : undefined;

  const presetBase = buildRoleReplacePreset(args.preset, args.imageModelRegistryId, understand);
  const preset: CustomAppModule = {
    ...presetBase,
    ...(aspectRatio ? { imageAspectRatio: aspectRatio } : {}),
  };

  const chunkLabel = roleReplaceCollageChunkLabel(rows, args.chunkIndex);
  const label = preset.label || preset.id;
  ctx.onLog?.(
    'info',
    `分镜表 · ${label} · ${chunkLabel} 拼图替换（${referenceImages.length} 张参考）…`
  );

  const result = await executeCapability(preset, collage.dataUrl, ctx, {
    inputText,
    inputImages: referenceImages,
    rejectTextTruncation: true,
  });

  if (!result.ok) {
    return { ok: false, error: result.error || '角色替换失败' };
  }
  if (result.kind !== 'image' || !String(result.image || '').trim()) {
    return { ok: false, error: '模型未返回有效图片' };
  }

  ctx.onLog?.('info', `分镜表 · ${chunkLabel} 拼图替换完成`);
  return {
    ok: true,
    image: result.image,
    layout: collage.layout,
    rowIds: rows.map((row) => row.id),
  };
}

export async function executeStoryboardRoleReplaceRedraw(
  args: StoryboardRoleReplaceRedrawArgs
): Promise<StoryboardRowRedrawResult> {
  return executeStoryboardRoleReplaceRow(args);
}
