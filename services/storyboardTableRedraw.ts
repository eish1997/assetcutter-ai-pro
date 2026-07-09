import type { CustomAppModule, StoryboardParseFieldDef, StoryboardTableRow } from '../types';
import { coerceImageModelRegistryId } from './modelRegistry/imageModels';
import { compileRedrawPrompt } from './storyboardTableParse';
import { capabilityUsesGenImageEngine, getCapabilityEngine } from './capabilityEngineKind';
import type { CapabilityExecuteContext } from './capabilityExecutor';
import { auditStoryboardGenFromCtx } from './storyboardTaskAuditEvents';
import {
  storyboardRowHasFrameRef,
} from './storyboardFrameImageUrl';
import { isStoryboardFeedbackRedrawEligible } from './storyboardEditEligibility';
import {
  STORYBOARD_ROLE_REPLACE_DEFAULT_PRESET_ID,
  getBuiltinStoryboardRoleReplacePreset,
  getBuiltinStoryboardFeedbackCollagePreset,
  STORYBOARD_FEEDBACK_COLLAGE_DEFAULT_PRESET_ID,
  DEFAULT_STORYBOARD_FEEDBACK_COLLAGE_INSTRUCTION,
} from './storyboardBuiltinPresets';

export {
  getBuiltinStoryboardFeedbackCollagePreset,
  STORYBOARD_FEEDBACK_COLLAGE_DEFAULT_PRESET_ID,
  DEFAULT_STORYBOARD_FEEDBACK_COLLAGE_INSTRUCTION,
} from './storyboardBuiltinPresets';
export { resolveStoryboardRowFrameDataUrl } from './storyboardRowFrameDataUrl';

export { isStoryboardFeedbackRedrawEligible };

export const STORYBOARD_REDRAW_PRESET_KEY = 'ac_storyboard_redraw_preset_v1';
/** @deprecated 编辑页已改为模型选择；保留键名供旧数据只读 */
export const STORYBOARD_EDIT_REDRAW_PRESET_KEY = 'ac_storyboard_edit_redraw_preset_v1';
/** 编辑页重绘/反馈重绘选用的生图 registryId，与解析页生图预设隔离 */
export const STORYBOARD_EDIT_REDRAW_MODEL_KEY = 'ac_storyboard_edit_redraw_model_v1';
/** 编辑页拼图改图（批量/单镜有图）选用的图生图能力预设 */
export const STORYBOARD_EDIT_FEEDBACK_COLLAGE_PRESET_KEY = 'ac_storyboard_edit_feedback_collage_preset_v1';

/** 编辑页拼图改图选用的生图 registryId */
export const STORYBOARD_EDIT_FEEDBACK_COLLAGE_MODEL_KEY = 'ac_storyboard_edit_feedback_collage_model_v1';
/** 反馈批量重绘是否走理解 LLM（关则直发反馈文本） */
export const STORYBOARD_EDIT_FEEDBACK_REDRAW_UNDERSTAND_KEY = 'ac_storyboard_edit_feedback_redraw_understand_v1';

export function buildStoryboardEditFeedbackPromptExtra(row: StoryboardTableRow): string {
  const text = (row.editFeedback ?? '').trim();
  if (!text) return '';
  return `【修改反馈】${text}`;
}

/** 反馈批量重绘专用：仅修改反馈正文，不含结构化字段 */
export function buildStoryboardFeedbackRedrawInputText(row: StoryboardTableRow): string {
  return (row.editFeedback ?? '').trim();
}

export function listStoryboardFeedbackRedrawRows(rows: StoryboardTableRow[]): StoryboardTableRow[] {
  return rows.filter((row) => !row.locked && Boolean((row.editFeedback ?? '').trim()));
}

export function listStoryboardRowsWithEditFeedback(rows: StoryboardTableRow[]): StoryboardTableRow[] {
  return rows.filter((row) => Boolean((row.editFeedback ?? '').trim()));
}

/** 拼接入队/理解用的镜头正文（结构化字段 + 镜头号 + 修改反馈） */
export function buildStoryboardRowPromptText(
  row: StoryboardTableRow,
  catalog: StoryboardParseFieldDef[],
  promptExtra?: string
): string {
  const feedback = buildStoryboardEditFeedbackPromptExtra(row);
  const mergedExtra = [promptExtra, feedback].filter(Boolean).join('\n').trim();
  return compileRedrawPrompt(row, catalog, mergedExtra || undefined);
}

export function listStoryboardRedrawPresets(presets: CustomAppModule[]): CustomAppModule[] {
  return presets.filter((p) => {
    if (p.enabled === false) return false;
    if (!capabilityUsesGenImageEngine(p)) return false;
    return p.category === 'text_to_image' || p.category === 'image_to_image';
  });
}

export function pickDefaultStoryboardRedrawPresetId(presets: CustomAppModule[]): string {
  const list = listStoryboardRedrawPresets(presets);
  return list[0]?.id ?? '';
}

/** 编辑页重绘：有分镜图走图生图预设，否则文生图 */
export function pickStoryboardEditRedrawPreset(
  presets: CustomAppModule[],
  row: StoryboardTableRow,
  opts?: { forceTextToImage?: boolean }
): CustomAppModule | null {
  const list = listStoryboardRedrawPresets(presets);
  if (!list.length) return null;
  const useImageRef = !opts?.forceTextToImage && storyboardRowHasFrameRef(row);
  const category = useImageRef ? 'image_to_image' : 'text_to_image';
  return list.find((p) => p.category === category) ?? list[0] ?? null;
}

export function listStoryboardFeedbackCollageRedrawPresets(
  presets: CustomAppModule[]
): CustomAppModule[] {
  const builtin = getBuiltinStoryboardFeedbackCollagePreset();
  const storedBuiltin = presets.find((p) => p.id === builtin.id);
  const tagged = presets.filter((p) => {
    if (p.enabled === false) return false;
    if (p.category !== 'image_to_image') return false;
    if (!capabilityUsesGenImageEngine(p)) return false;
    return (
      p.id.startsWith('storyboard_collage_') ||
      p.id === builtin.id ||
      p.id === STORYBOARD_ROLE_REPLACE_DEFAULT_PRESET_ID
    );
  });
  const byId = new Map<string, CustomAppModule>();
  for (const p of tagged) byId.set(p.id, p);
  if (!storedBuiltin) {
    byId.set(builtin.id, builtin);
  } else if (storedBuiltin.enabled !== false) {
    byId.set(builtin.id, { ...builtin, ...storedBuiltin });
  }
  const roleBuiltin = getBuiltinStoryboardRoleReplacePreset();
  const storedRole = presets.find((p) => p.id === roleBuiltin.id);
  if (!storedRole) {
    byId.set(roleBuiltin.id, roleBuiltin);
  } else if (storedRole.enabled !== false) {
    byId.set(roleBuiltin.id, { ...roleBuiltin, ...storedRole });
  }
  const list = [...byId.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  if (list.length > 0) return list;
  return listStoryboardRedrawPresets(presets).filter((p) => p.category === 'image_to_image');
}

function listStoryboardFeedbackCollageOnlyPresets(presets: CustomAppModule[]): CustomAppModule[] {
  return listStoryboardFeedbackCollageRedrawPresets(presets).filter(
    (p) =>
      p.id === STORYBOARD_FEEDBACK_COLLAGE_DEFAULT_PRESET_ID || p.id.startsWith('storyboard_collage_')
  );
}

export function pickDefaultStoryboardFeedbackCollagePresetId(presets: CustomAppModule[]): string {
  const list = listStoryboardFeedbackCollageOnlyPresets(presets);
  const seeded = list.find((p) => p.id === STORYBOARD_FEEDBACK_COLLAGE_DEFAULT_PRESET_ID);
  if (seeded) return seeded.id;
  return list[0]?.id ?? '';
}

export function resolveStoryboardFeedbackCollagePreset(
  presets: CustomAppModule[],
  presetId?: string | null
): CustomAppModule | null {
  const list = listStoryboardFeedbackCollageRedrawPresets(presets);
  if (!list.length) return null;
  const id = String(presetId ?? '').trim();
  if (id) {
    const matched = list.find((p) => p.id === id);
    if (matched) return matched;
  }
  const collageOnly = listStoryboardFeedbackCollageOnlyPresets(presets);
  if (!collageOnly.length) return null;
  const defaultId = pickDefaultStoryboardFeedbackCollagePresetId(presets);
  return collageOnly.find((p) => p.id === defaultId) ?? collageOnly[0] ?? null;
}

/** @deprecated 使用 resolveStoryboardFeedbackCollagePreset */
export function pickStoryboardFeedbackRedrawPreset(presets: CustomAppModule[]): CustomAppModule | null {
  return resolveStoryboardFeedbackCollagePreset(presets, null);
}

export type StoryboardRowRedrawArgs = {
  preset: CustomAppModule;
  /** 有分镜图拼图重绘时优先使用（应与 preset 一致） */
  collagePreset?: CustomAppModule;
  row: StoryboardTableRow;
  fieldCatalog: StoryboardParseFieldDef[];
  ctx: CapabilityExecuteContext;
  /** 覆盖预设内绑定的生图 registryId（编辑页模型选择） */
  imageModelRegistryId?: string;
  /** 附加在镜头文本后的微调（如 P2 批量反馈） */
  promptExtra?: string;
  companionBaseUrl?: string;
  companionProjectId?: string;
  /** true：有分镜图时强制文生图（忽略图生图预设的参考图） */
  forceTextToImage?: boolean;
  /** 反馈批量重绘：仅当前分镜图 + 修改反馈文本，不带结构化字段 */
  feedbackOnly?: boolean;
  /** 反馈批量重绘：是否走理解 LLM（false = 直发反馈文本） */
  understand?: boolean;
};

export type StoryboardRowRedrawInvokeOptions = {
  /** 反馈批量重绘：仅分镜图 + 修改反馈文本 */
  feedbackOnly?: boolean;
  /** 反馈批量重绘：是否走理解 LLM */
  understand?: boolean;
  /** 拼图改图能力预设 id（编辑页选择，缺省取持久化默认） */
  collagePresetId?: string;
};

export type StoryboardRowRedrawResult =
  | { ok: true; image: string }
  | { ok: false; error: string };

/**
 * 单行分镜重绘：有分镜图时走拼图改图（1 镜拼 1 张 + 布局切分）；否则文生图直出。
 */
export async function executeStoryboardRowRedraw(
  args: StoryboardRowRedrawArgs
): Promise<StoryboardRowRedrawResult> {
  const {
    preset: rawPreset,
    row,
    fieldCatalog,
    ctx,
    promptExtra,
  } = args;
  const presetBase =
    args.imageModelRegistryId != null && String(args.imageModelRegistryId).trim()
      ? {
          ...rawPreset,
          imageModelRegistryId: coerceImageModelRegistryId(args.imageModelRegistryId),
        }
      : rawPreset;
  const understand = args.feedbackOnly ? args.understand !== false : true;

  if (getCapabilityEngine(presetBase) !== 'gen_image') {
    return { ok: false, error: '请选择文生图或图生图类能力' };
  }

  const useImageRef =
    !args.forceTextToImage &&
    (args.feedbackOnly || presetBase.category === 'image_to_image') &&
    storyboardRowHasFrameRef(row);

  const collageCap = args.collagePreset ?? (useImageRef ? presetBase : null);
  const textPreset = pickStoryboardEditRedrawPreset([presetBase], row) ?? presetBase;

  const inputText = args.feedbackOnly
    ? buildStoryboardFeedbackRedrawInputText(row)
    : buildStoryboardRowPromptText(row, fieldCatalog, promptExtra);
  if (!inputText) {
    return {
      ok: false,
      error: args.feedbackOnly ? '请先填写修改反馈' : '请先解析或填写画面类字段',
    };
  }

  if (useImageRef) {
    if (!collageCap || collageCap.disabled) {
      return { ok: false, error: '请选择拼图改图能力（图生图）' };
    }
    const feedback = (row.editFeedback ?? '').trim();
    if (!feedback) {
      return { ok: false, error: '拼图改图请先填写修改反馈' };
    }
    const { executeStoryboardCollageRedraw } = await import('./storyboardFeedbackSheetRedraw');
    const collageOutcome = await executeStoryboardCollageRedraw({
      preset: collageCap,
      rows: [row],
      fieldCatalog,
      ctx,
      imageModelRegistryId: args.imageModelRegistryId,
      understand,
      companionBaseUrl: args.companionBaseUrl,
      companionProjectId: args.companionProjectId,
      auditOperation: args.feedbackOnly ? 'feedback_redraw' : 'row_redraw',
    });
    if (!collageOutcome.ok) {
      return { ok: false, error: collageOutcome.error };
    }

    ctx.onLog?.('info', `分镜表 · 镜头 ${row.shotNo || row.index + 1} 重绘完成`);
    return { ok: true, image: collageOutcome.image };
  }

  if ((args.feedbackOnly || presetBase.category === 'image_to_image') && !useImageRef && !args.forceTextToImage) {
    return {
      ok: false,
      error: args.feedbackOnly ? '反馈重绘需要本镜已有分镜图' : '图生图重绘需要本镜已有分镜图，或改选文生图能力',
    };
  }

  const textPresetForRun = textPreset;
  const label = textPresetForRun.label || textPresetForRun.id;
  ctx.onLog?.('info', `分镜表 · ${label} · 镜头 ${row.shotNo || row.index + 1} 重绘中…`);

  const { executeCapability } = await import('./capabilityExecutor');
  const result = await executeCapability(textPresetForRun, '', ctx, {
    inputText,
    rejectTextTruncation: true,
  });

  const shotLabel = row.shotNo || String(row.index + 1);
  if (!result.ok) {
    auditStoryboardGenFromCtx(ctx, args.feedbackOnly ? 'feedback_redraw' : 'row_redraw', false, `分镜表 · 镜头 ${shotLabel} 重绘失败：${result.error || '生图失败'}`, {
      rowId: row.id,
      detail: { presetId: textPresetForRun.id },
    });
    return { ok: false, error: result.error || '生图失败' };
  }
  if (result.kind !== 'image' || !String(result.image || '').trim()) {
    auditStoryboardGenFromCtx(ctx, args.feedbackOnly ? 'feedback_redraw' : 'row_redraw', false, `分镜表 · 镜头 ${shotLabel} 重绘失败：模型未返回有效图片`, {
      rowId: row.id,
      detail: { presetId: textPresetForRun.id },
    });
    return { ok: false, error: '模型未返回有效图片' };
  }

  ctx.onLog?.('info', `分镜表 · 镜头 ${shotLabel} 重绘完成`);
  auditStoryboardGenFromCtx(ctx, args.feedbackOnly ? 'feedback_redraw' : 'row_redraw', true, `分镜表 · 镜头 ${shotLabel} 重绘完成`, {
    rowId: row.id,
    detail: { presetId: textPresetForRun.id, presetLabel: label },
  });
  return { ok: true, image: result.image };
}
