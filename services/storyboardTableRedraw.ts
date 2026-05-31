import type { CustomAppModule, StoryboardParseFieldDef, StoryboardTableRow } from '../types';
import { compileRedrawPrompt } from './storyboardTableParse';
import {
  capabilityUsesGenImageEngine,
  executeCapability,
  getCapabilityEngine,
  type CapabilityExecuteContext,
} from './capabilityExecutor';
import {
  fetchWorkflowOriginalFromCompanionAsObjectUrl,
  imageSrcToDataUrlForCompanion,
} from './workflowCompanionAssets';
import {
  resolveStoryboardRowFrameDisplaySrc,
  storyboardRowHasFrameRef,
} from './storyboardFrameImageUrl';

export const STORYBOARD_REDRAW_PRESET_KEY = 'ac_storyboard_redraw_preset_v1';
/** 编辑页重绘/反馈重绘专用，与解析页生图预设隔离 */
export const STORYBOARD_EDIT_REDRAW_PRESET_KEY = 'ac_storyboard_edit_redraw_preset_v1';

export function buildStoryboardEditFeedbackPromptExtra(row: StoryboardTableRow): string {
  const text = (row.editFeedback ?? '').trim();
  if (!text) return '';
  return `【修改反馈】${text}`;
}

export function listStoryboardFeedbackRedrawRows(rows: StoryboardTableRow[]): StoryboardTableRow[] {
  return rows.filter((row) => !row.locked && Boolean((row.editFeedback ?? '').trim()));
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

async function resolveRowFrameImage(
  frameImage: string,
  companionBaseUrl: string,
  companionProjectId: string
): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string }> {
  const trimmed = String(frameImage || '').trim();
  if (!trimmed) {
    return { ok: false, error: '当前镜头没有参考图' };
  }
  const normalized = await imageSrcToDataUrlForCompanion(trimmed);
  if (normalized) return { ok: true, dataUrl: normalized };
  if (!companionBaseUrl.trim() || !companionProjectId.trim()) {
    return { ok: false, error: '参考图无法解析，请重新上传或连接本机伴侣' };
  }
  return { ok: false, error: '参考图无法加载，请在本镜重新上传' };
}

export async function resolveStoryboardRowFrameDataUrl(
  row: StoryboardTableRow,
  companionBaseUrl: string,
  companionProjectId: string
): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string }> {
  const direct = String(row.frameImage || '').trim();
  if (direct) {
    return resolveRowFrameImage(direct, companionBaseUrl, companionProjectId);
  }

  const display = resolveStoryboardRowFrameDisplaySrc(row);
  if (display) {
    const normalized = await imageSrcToDataUrlForCompanion(display);
    if (normalized) return { ok: true, dataUrl: normalized };
  }

  const companionKey = String(row.frameImageCompanionKey || '').trim();
  if (companionKey) {
    const base = String(companionBaseUrl || '').trim();
    const pid = String(companionProjectId || '').trim();
    if (!base || !pid) {
      return { ok: false, error: '参考图在本地伴侣中，请连接本机伴侣后重试' };
    }
    const got = await fetchWorkflowOriginalFromCompanionAsObjectUrl(base, pid, companionKey);
    if (got.ok === false) {
      return { ok: false, error: '参考图无法从伴侣加载，请重新上传' };
    }
    const resolved = await resolveRowFrameImage(got.objectUrl, base, pid);
    URL.revokeObjectURL(got.objectUrl);
    return resolved;
  }

  return { ok: false, error: '当前镜头没有参考图' };
}

export type StoryboardRowRedrawArgs = {
  preset: CustomAppModule;
  row: StoryboardTableRow;
  fieldCatalog: StoryboardParseFieldDef[];
  ctx: CapabilityExecuteContext;
  /** 附加在镜头文本后的微调（如 P2 批量反馈） */
  promptExtra?: string;
  companionBaseUrl?: string;
  companionProjectId?: string;
  /** true：有分镜图时强制文生图（忽略图生图预设的参考图） */
  forceTextToImage?: boolean;
};

export type StoryboardRowRedrawResult =
  | { ok: true; image: string }
  | { ok: false; error: string };

/**
 * 单行分镜重绘：走能力执行器（文生图 / 图生图），不写回独立 WorkflowAsset。
 */
export async function executeStoryboardRowRedraw(
  args: StoryboardRowRedrawArgs
): Promise<StoryboardRowRedrawResult> {
  const { preset, row, fieldCatalog, ctx, promptExtra, companionBaseUrl = '', companionProjectId = '' } = args;

  if (getCapabilityEngine(preset) !== 'gen_image') {
    return { ok: false, error: '请选择文生图或图生图类能力' };
  }

  const inputText = buildStoryboardRowPromptText(row, fieldCatalog, promptExtra);
  if (!inputText) {
    return { ok: false, error: '请先解析或填写画面类字段' };
  }

  const useImageRef =
    !args.forceTextToImage &&
    preset.category === 'image_to_image' &&
    storyboardRowHasFrameRef(row);

  let inputImage = '';
  if (useImageRef) {
    const resolved = await resolveStoryboardRowFrameDataUrl(
      row,
      companionBaseUrl,
      companionProjectId
    );
    if (resolved.ok === false) return { ok: false, error: resolved.error };
    inputImage = resolved.dataUrl;
  }

  if (preset.category === 'image_to_image' && !useImageRef && !args.forceTextToImage) {
    return {
      ok: false,
      error: '图生图重绘需要本镜已有分镜图，或改选文生图能力',
    };
  }

  const label = preset.label || preset.id;
  ctx.onLog?.('info', `分镜表 · ${label} · 镜头 ${row.shotNo || row.index + 1} 重绘中…`);

  const result = await executeCapability(preset, inputImage, ctx, { inputText });

  if (!result.ok) {
    return { ok: false, error: result.error || '生图失败' };
  }
  if (result.kind !== 'image' || !String(result.image || '').trim()) {
    return { ok: false, error: '模型未返回有效图片' };
  }

  ctx.onLog?.('info', `分镜表 · 镜头 ${row.shotNo || row.index + 1} 重绘完成`);
  return { ok: true, image: result.image };
}
