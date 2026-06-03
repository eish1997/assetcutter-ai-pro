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
import { computeStoryboardMosaicGrid } from './storyboardFrameStripMerge';
import type { FeedbackCollageLayout } from './storyboardFeedbackCollageSplit';
import {
  renderStoryboardFeedbackCollage,
} from './storyboardFeedbackSheetRedraw';
import { chunkStoryboardRowsByCount } from './storyboardTableSheetGen';
import type { StoryboardSheetGenTask } from './storyboardTableSheetGen';
import { storyboardRowHasFrameRef } from './storyboardFrameImageUrl';
import { type StoryboardRowRedrawResult } from './storyboardTableRedraw';
import { compileRedrawPrompt } from './storyboardTableParse';
import {
  resolveStoryboardNamedAssetImageDataUrl,
  storyboardNamedAssetHasImageRef,
} from './storyboardNamedAssetImage';
import { isStoryboardRoleReplaceEligible } from './storyboardEditEligibility';

export { isStoryboardRoleReplaceEligible };

export const STORYBOARD_ROLE_REPLACE_DEFAULT_PRESET_ID = 'storyboard_role_replace_v1';
export const DEFAULT_STORYBOARD_ROLE_REPLACE_INSTRUCTION = `你是分镜表角色替换改图助手。

输入包含多张参考图：第 1 张为多镜拼图或当前镜头分镜图；其余各张为对应角色的外貌/造型参考。

请按用户消息中的「角色替换」说明，在指定格内/画面位置把人物替换为参考图中该角色的外貌，同时保持：
- 用户消息中各镜「画面说明」所描述的场景、动作、构图、背景、光影、景别与整体画风；
- 拼图时保持格数、格线、排列顺序与整体尺寸；
- 未提及替换的区域不被改动；
- 输出完整分镜插画，不要添加文字说明条或边框。`;

export type StoryboardRoleReplaceMarkPlan = {
  mark: StoryboardFrameRoleMark;
  asset: StoryboardRoleAsset;
  assetImage: string;
  /** 在 referenceImages 中的序号（0 为拼图/分镜图） */
  refIndex: number;
};

export type StoryboardRoleReplacePlan = {
  marks: StoryboardRoleReplaceMarkPlan[];
  referenceImages: string[];
};

export type StoryboardRoleReplaceChunkRefs = {
  referenceImages: string[];
  rowMarkPlans: Map<string, StoryboardRoleReplaceMarkPlan[]>;
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

/** 本镜结构化画面描述（redrawInclude 字段），用于锚定场景避免改偏 */
export function compileStoryboardRoleReplaceSceneBlock(
  row: StoryboardTableRow,
  fieldCatalog: StoryboardParseFieldDef[]
): string {
  const text = compileRedrawPrompt(row, fieldCatalog).trim();
  if (!text) return '';
  return `画面说明（须保持，勿改偏）：\n${text}`;
}

function compileStoryboardRoleReplaceMarkLines(
  markPlans: StoryboardRoleReplaceMarkPlan[],
  collageCell: boolean
): string[] {
  return markPlans.map((item) => {
    const pos = formatRoleReplacePosition(item.mark);
    const where = collageCell ? '在本格画面' : '在画面';
    return `- ${where} ${pos} 附近，将角色「${item.mark.name}」替换为参考图 ${item.refIndex + 1} 中的人物外貌与造型。`;
  });
}

export function compileStoryboardRoleReplacePrompt(
  row: StoryboardTableRow,
  plan: StoryboardRoleReplacePlan,
  fieldCatalog: StoryboardParseFieldDef[] = []
): string {
  const shotLabel = (row.shotNo || '').trim() || `镜头 ${row.index + 1}`;
  const sceneBlock = compileStoryboardRoleReplaceSceneBlock(row, fieldCatalog);
  const replaceLines = compileStoryboardRoleReplaceMarkLines(plan.marks, false);
  const parts = [`【${shotLabel} · 角色替换】`];
  if (sceneBlock) parts.push(sceneBlock);
  parts.push('角色替换：', ...replaceLines);
  return parts.join('\n');
}

export function compileStoryboardRoleReplaceCollagePrompt(
  rows: StoryboardTableRow[],
  rowMarkPlans: Map<string, StoryboardRoleReplaceMarkPlan[]>,
  fieldCatalog: StoryboardParseFieldDef[] = []
): string {
  const { cols, rows: gridRows } = computeStoryboardMosaicGrid(rows.length);
  const parts = [
    `【本次拼图】约 ${cols} 列 × ${gridRows} 行，共 ${rows.length} 格，从左到右、从上到下对应下列镜号。`,
    '参考图 1 为本拼图；参考图 2 起为各角色外貌/造型参考。',
    '替换角色时须严格保持各镜「画面说明」中的场景与构图，仅替换标注位置的人物外貌。',
  ];

  rows.forEach((row, index) => {
    const label = (row.shotNo || '').trim() || `镜头 ${index + 1}`;
    const markPlans = rowMarkPlans.get(row.id) ?? [];
    if (!markPlans.length) return;
    const sceneBlock = compileStoryboardRoleReplaceSceneBlock(row, fieldCatalog);
    const replaceLines = compileStoryboardRoleReplaceMarkLines(markPlans, true);
    const section = [sceneBlock, '角色替换：', ...replaceLines].filter(Boolean).join('\n');
    parts.push(`--- ${label} ---\n${section}`);
  });

  return parts.join('\n\n').trim();
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

export async function buildStoryboardRoleReplaceChunkRefs(
  collageDataUrl: string,
  rows: StoryboardTableRow[],
  roleAssets: StoryboardRoleAsset[],
  companion?: { companionBaseUrl?: string; companionProjectId?: string }
): Promise<{ ok: true; refs: StoryboardRoleReplaceChunkRefs } | { ok: false; error: string }> {
  const referenceImages: string[] = [collageDataUrl];
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
  }

  if (rowMarkPlans.size === 0) {
    return { ok: false, error: '本批没有可替换的角色标注' };
  }

  return { ok: true, refs: { referenceImages, rowMarkPlans } };
}

export async function planStoryboardRoleReplace(
  row: StoryboardTableRow,
  roleAssets: StoryboardRoleAsset[],
  frameDataUrl: string
): Promise<{ ok: true; plan: StoryboardRoleReplacePlan } | { ok: false; error: string }> {
  const built = await buildStoryboardRoleReplaceChunkRefs(frameDataUrl, [row], roleAssets);
  if (!built.ok) return built;
  const marks = built.refs.rowMarkPlans.get(row.id) ?? [];
  return {
    ok: true,
    plan: { marks, referenceImages: built.refs.referenceImages },
  };
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

export async function executeStoryboardRoleReplaceCollageBatch(
  args: StoryboardRoleReplaceCollageBatchArgs
): Promise<
  { ok: true; image: string; layout: FeedbackCollageLayout } | { ok: false; error: string }
> {
  const { rows, roleAssets, ctx, understand = true } = args;

  if (getCapabilityEngine(args.preset) !== 'gen_image') {
    return { ok: false, error: '请选择图生图类能力' };
  }
  if (!capabilityUsesGenImageEngine(args.preset)) {
    return { ok: false, error: '当前能力不支持生图' };
  }
  if (!rows.length) {
    return { ok: false, error: '本任务没有可用镜头' };
  }

  for (const row of rows) {
    if (!isStoryboardRoleReplaceEligible(row, roleAssets)) {
      return { ok: false, error: `镜头 ${row.shotNo || row.index + 1} 不满足角色替换条件` };
    }
  }

  const collage = await renderStoryboardFeedbackCollage(rows, []);
  if (!collage) {
    return { ok: false, error: '拼图失败，请确认各镜已有分镜图' };
  }

  const built = await buildStoryboardRoleReplaceChunkRefs(collage.dataUrl, rows, roleAssets, {
    companionBaseUrl: args.companionBaseUrl,
    companionProjectId: args.companionProjectId ?? args.ctx.companionProjectId,
  });
  if (!built.ok) {
    return { ok: false, error: built.error };
  }

  const inputText = compileStoryboardRoleReplaceCollagePrompt(
    rows,
    built.refs.rowMarkPlans,
    args.fieldCatalog
  );
  if (!inputText) {
    return { ok: false, error: '未能生成角色替换说明' };
  }

  const preset = buildRoleReplacePreset(args.preset, args.imageModelRegistryId, understand);
  const chunkLabel =
    args.chunkIndex != null
      ? `角色替换拼图 ${args.chunkIndex + 1}`
      : rows.length === 1
        ? `镜头 ${rows[0]!.shotNo || rows[0]!.index + 1} 角色替换`
        : `角色替换拼图 ${rows.length} 镜`;
  const label = preset.label || preset.id;
  ctx.onLog?.('info', `分镜表 · ${label} · ${chunkLabel} 改图中…`);

  const result = await executeCapability(preset, built.refs.referenceImages[0]!, ctx, {
    inputText,
    inputImages: built.refs.referenceImages,
    rejectTextTruncation: true,
  });

  if (!result.ok) {
    return { ok: false, error: result.error || '角色替换失败' };
  }
  if (result.kind !== 'image' || !String(result.image || '').trim()) {
    return { ok: false, error: '模型未返回有效图片' };
  }

  ctx.onLog?.('info', `分镜表 · ${chunkLabel} 角色替换完成`);
  return { ok: true, image: result.image, layout: collage.layout };
}

export async function executeStoryboardRoleReplaceRedraw(
  args: StoryboardRoleReplaceRedrawArgs
): Promise<StoryboardRowRedrawResult> {
  const outcome = await executeStoryboardRoleReplaceCollageBatch({
    preset: args.preset,
    rows: [args.row],
    roleAssets: args.roleAssets,
    fieldCatalog: args.fieldCatalog,
    ctx: args.ctx,
    imageModelRegistryId: args.imageModelRegistryId,
    understand: args.understand,
    companionBaseUrl: args.companionBaseUrl,
    companionProjectId: args.companionProjectId ?? args.ctx.companionProjectId,
  });
  if (!outcome.ok) {
    return { ok: false, error: outcome.error };
  }
  return { ok: true, image: outcome.image };
}
