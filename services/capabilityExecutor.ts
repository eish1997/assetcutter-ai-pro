import type {
  CustomAppModule,
  CapabilitySet,
  CapabilitySetNode,
  CapabilitySetEdge,
} from '../types';
import {
  planCapabilityModuleRoutes,
  planCapabilitySetRoutes,
  sumPlatformMinCredits,
  type CapabilityCreditOverrides,
} from './aiBillingGate';
import { mergePrimaryAndReferenceImageUrls } from './quickComposeMention';
import { maxReferenceImagesForImageModel } from '../types';
import {
  resolveImageModelRegistryId,
} from './modelRegistry/imageModels';
import type { VgpGenStepCapture } from '../types/vgp';
import {
  CAPABILITY_UNDERSTAND_RETRY_OPTIONS,
  DEFAULT_PROMPTS,
  detectObjectsInImage,
  normalizeApiErrorMessage,
  workflowChat,
  workflowGenerateImage,
  workflowGenerateImageMultiRefs,
  workflowGenerateVideo,
  workflowUnderstandForImageGen,
  WorkflowVideoNotAvailableError,
  type GeminiImageBatchGroupOptions,
} from './unifiedAiGateway';
import {
  formatAiPipelineStepError,
  isAiPipelineStepError,
  type AiPipelineStep,
} from './aiPipelineStepError';
import { formatPipelineStepProgress, planCapabilityPipelineSteps } from './aiPipelineStepPlan';
import { shouldRunCapabilityUnderstand } from './workflowUnderstandOverride';
import { textModelFamily } from './modelRegistry/textModels';
import { resolveTextModelForPreset, resolveTextModelFromContext } from './capabilityTextModel';
import { normalizeDataUrlForVisionApi } from './workflowImageDataUrlCompress';
export { resolveTextModelForPreset } from './capabilityTextModel';
import {
  clampWorkflowTextForSend,
  resolveWorkflowTextSendLimit,
  type WorkflowTextSendBudgetKind,
} from './workflowTextLimits';
import { resolveUpstreamImageModelId, resolveUpstreamTextModelId } from './modelRegistry/resolve';
import {
  submitCompanionHostBundleExecJob,
  submitCompanionHostBundleProbeJob,
} from './companionClient/compute';
import { getCompanionLocalBaseUrl, normalizeCompanionBaseUrl } from './companionLocalPrefs';
import {
  readRemoveBgParams,
  resolveImageProcessorId,
  type ImageProcessorId,
} from './capabilityProcessors/imageProcessProcessors';
import {
  getCapabilityEngine,
  isImageProcessPreset,
} from './capabilityEngineKind';
export {
  getCapabilityEngine,
  capabilityUsesGenImageEngine,
  isImageProcessPreset,
} from './capabilityEngineKind';

export type CapabilityRunProgressMeta = {
  /** 能力集合画布节点 id，用于把进度归到具体卡片 */
  nodeId?: string;
  /** P2：串行步骤序号（1-based） */
  stepIndex?: number;
  stepTotal?: number;
};

export type CapabilityExecuteContext = {
  /**
   * 理解 / gen_text / 物体检测等使用的文本侧 **registryId**（与设置页 `SystemConfig.modelText` 一致）；
   * 未传则回退 `DEFAULT_MODEL_TEXT`。
   */
  textModelRegistryId?: string;
  /** 用于日志输出（可选） */
  onLog?: (level: 'info' | 'warn' | 'error', message: string, detail?: string) => void;
  /** 能力集合画布等：单步进度文案（可选）；meta.nodeId 归因到节点 */
  onRunProgress?: (message: string, meta?: CapabilityRunProgressMeta) => void;
  /**
   * 能力集合执行到某画布节点时，由 executeCapabilitySet 写入；
   * executeCapability 内向 onRunProgress 附带此 nodeId。
   */
  runProgressNodeId?: string;
  /**
   * 阶段 B：默认 `legacy`（先理解预设提示词再生图）。
   * `compiler` 为规则编译器直出英文指令，不调用「理解」LLM。
   */
  promptResolution?: 'legacy' | 'compiler';
  /** 编译器输入：目标摘要、维度约束等 */
  semanticForCompiler?: {
    targetSummary?: string;
    dimensions?: Record<string, string | undefined>;
  };
  /** 工作区当前项目 id，随 `host_bundle.*` 任务一并提交给本机伴侣（可选） */
  companionProjectId?: string;
  /** 分镜表资产 id：分镜内 AI 生图/LLM 任务审计上报管理端（可选） */
  storyboardAssetId?: string;
  /** 本机分割等：当前队列任务对应的资产 id（能力集合单卡执行时由 WorkflowSection 注入） */
  workflowAssetId?: string;
  /** 与 `WorkflowPendingTask.inputSourceDisplayKey` 一致；缺省按 original */
  workflowSourceDisplayKey?: string;
};

export type CapabilityExecuteResult =
  | {
      ok: true;
      kind: 'image';
      image: string;
      durationMs: number;
      vgpSteps?: VgpGenStepCapture[];
      /** 各节点在当次执行中的图像输出（画布测试预览用） */
      nodeImageOutputs?: Record<string, string>;
    }
  | {
      ok: true;
      kind: 'video';
      videoUrl: string;
      mimeType?: string;
      durationMs: number;
      vgpSteps?: VgpGenStepCapture[];
      nodeImageOutputs?: Record<string, string>;
    }
  | { ok: true; kind: 'text'; text: string; durationMs: number }
  | {
      ok: false;
      kind: 'none';
      error: string;
      durationMs: number;
      /** 失败前已完成的节点图像（画布可合并显示） */
      nodeImageOutputs?: Record<string, string>;
      /** 失败所在画布节点（若有） */
      failedNodeId?: string;
    };

/** 文本侧 upstream model id（经 pickBinding / resolve） */
export function resolveTextModelIdFromContext(ctx: CapabilityExecuteContext): string {
  return resolveUpstreamTextModelId(resolveTextModelFromContext(ctx));
}

function parseInlineForLlm(input: string): { mimeType: string; data: string } {
  const raw = (input || '').trim();
  const matched = raw.match(/^data:([^;,]+);base64,(.+)$/i);
  if (matched) {
    return { mimeType: matched[1] || 'image/jpeg', data: matched[2] || '' };
  }
  return { mimeType: 'image/jpeg', data: raw };
}

function hasUsableImageBase64(input: string): boolean {
  const raw = String(input || '').trim();
  if (!raw) return false;
  if (/^data:/i.test(raw)) {
    const p = parseInlineForLlm(raw);
    return Boolean(p.data?.length);
  }
  const stripped = raw.replace(/\s/g, '');
  if (stripped.length >= 64 && /^[A-Za-z0-9+/]+=*$/.test(stripped)) return true;
  return false;
}

function emitCapabilityRunProgress(
  ctx: CapabilityExecuteContext,
  message: string,
  meta?: CapabilityRunProgressMeta
) {
  const nid = meta?.nodeId ?? ctx.runProgressNodeId;
  const line =
    meta?.stepIndex != null && meta?.stepTotal != null && meta.stepTotal > 1
      ? formatPipelineStepProgress(meta.stepIndex, meta.stepTotal, message)
      : message;
  ctx.onRunProgress?.(line, nid ? { ...meta, nodeId: nid } : meta);
}

function makeVgpCapture(
  preset: CustomAppModule,
  understoodPrompt: string,
  modelId: string,
  stepKeyOverride?: string
): VgpGenStepCapture {
  return {
    stepKey: stepKeyOverride ?? preset.id,
    understoodPrompt,
    presetId: preset.id,
    presetLabel: preset.label || preset.id,
    modelId,
    gear: preset.imageModelRegistryId ?? preset.imageGear,
    aspectRatio: preset.imageAspectRatio,
    imageSize: preset.imageSize,
  };
}

export function resolveImageModelIdFromPreset(preset: Pick<CustomAppModule, 'imageModelRegistryId' | 'imageGear'>): string {
  const registryId = resolveImageModelRegistryId(
    preset.imageModelRegistryId ?? preset.imageGear ?? undefined
  );
  return resolveUpstreamImageModelId(registryId);
}

/** @deprecated 请用 `resolveImageModelIdFromPreset` */
export function resolveImageModelId(gearOrRegistryId?: string): string {
  return resolveUpstreamImageModelId(resolveImageModelRegistryId(gearOrRegistryId));
}

function refsForUnderstand(refs: string[]): string | string[] | null {
  const usable = refs.filter((s) => hasUsableImageBase64(s));
  if (usable.length === 0) return null;
  if (usable.length > 1) return usable;
  return usable[0]!;
}

/**
 * 工作流生图：先将预设与用户说明交给文字模型理解（多参考图时传全图），再拿理解结果调用生图模型。
 */
async function resolveCapabilityPrompt(
  preset: CustomAppModule,
  refs: string[],
  userText: string,
  ctx: CapabilityExecuteContext
): Promise<string | null> {
  const presetPrompt = (preset.instruction || '').trim();
  const ut = clampInputTextForSend(
    userText || '',
    'pre_image_understand',
    preset,
    ctx,
    refs.filter((s) => hasUsableImageBase64(s)).length
  );
  if (!presetPrompt && !ut) return null;
  if (!shouldRunCapabilityUnderstand(preset)) {
    ctx.onLog?.('info', `[${preset.label || preset.id}] 未启用理解，提示词直发生图`, undefined);
    return [presetPrompt, ut].filter(Boolean).join('\n\n').trim() || null;
  }
  ctx.onLog?.('info', `[${preset.label || preset.id}] 理解图片与提示词中…`, undefined);
  const combined = clampInputTextForSend(
    [presetPrompt, ut].filter(Boolean).join('\n\n'),
    'understand',
    preset,
    ctx,
    refs.filter((s) => hasUsableImageBase64(s)).length
  );
  const { instruction } = await workflowUnderstandForImageGen(
    refsForUnderstand(refs),
    combined,
    resolveTextModelForPreset(preset, ctx),
    undefined,
    CAPABILITY_UNDERSTAND_RETRY_OPTIONS
  );
  const understood = (instruction || '').trim();
  return understood.length > 0 ? understood : null;
}

async function resolveGenImagePrompt(
  preset: CustomAppModule,
  refs: string[],
  userText: string,
  ctx: CapabilityExecuteContext
): Promise<string | null> {
  const ut = (userText || '').trim();
  if (!shouldRunCapabilityUnderstand(preset, { userText: ut })) {
    const directPrompt = [(preset.instruction || '').trim(), ut].filter(Boolean).join('\n\n').trim();
    return directPrompt || null;
  }
  if (ctx.promptResolution === 'compiler') {
    const { compilePromptForCapability } = await import('./compiler/compilePrompt');
    const out = compilePromptForCapability({
      preset,
      targetSummary: ctx.semanticForCompiler?.targetSummary,
      dimensions: ctx.semanticForCompiler?.dimensions,
    });
    if (out.compiled_prompt.trim()) {
      ctx.onLog?.(
        'info',
        `[${preset.label || preset.id}] 使用规则编译器生成指令（${out.compiler_version}）`,
        undefined
      );
      return out.compiled_prompt;
    }
  }
  return resolveCapabilityPrompt(preset, refs, ut, ctx);
}

async function resolveTextOnlyImagePrompt(
  preset: CustomAppModule,
  userText: string,
  ctx: CapabilityExecuteContext,
  textSendBudgetKind: WorkflowTextSendBudgetKind = 'pre_image_understand',
  skipTextClamp = false
): Promise<string | null> {
  const presetPrompt = (preset.instruction || '').trim();
  const ut = skipTextClamp
    ? String(userText || '').trim()
    : clampInputTextForSend(userText || '', textSendBudgetKind, preset, ctx, 0);
  if (!shouldRunCapabilityUnderstand(preset, { userText: ut })) {
    const merged = [presetPrompt, ut].filter(Boolean).join('\n\n').trim();
    return merged || null;
  }
  ctx.onLog?.('info', `[${preset.label || preset.id}] 整理文生图提示词中…`, undefined);
  const fused = await workflowChat(
    [
      {
        role: 'user',
        parts: [
          {
            text: `你是生图提示词助手。将「预设」与「用户文字」融合为一段可直接用于文生图的简洁画面描述（中文或英文均可，只输出描述正文）。\n\n【预设】\n${presetPrompt || '(无)'}\n\n【用户文字】\n${ut || '(无)'}`,
          },
        ],
      },
    ],
    resolveTextModelForPreset(preset, ctx)
  );
  const out = (fused || '').trim();
  return out.length > 0 ? out : null;
}

const GEN_TEXT_VISION_MAX_IMAGES = 10;
const WORKFLOW_VIDEO_MAX_REF_IMAGES = 8;

function textFamilyForPreset(preset: CustomAppModule, ctx: CapabilityExecuteContext) {
  return textModelFamily(resolveTextModelForPreset(preset, ctx));
}

function clampInputTextForSend(
  raw: string,
  kind: WorkflowTextSendBudgetKind,
  preset: CustomAppModule,
  ctx: CapabilityExecuteContext,
  referenceImageCount = 0
): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  const limit = resolveWorkflowTextSendLimit(kind, {
    modelFamily: textFamilyForPreset(preset, ctx),
    referenceImageCount,
  });
  const { text, truncated, originalLength } = clampWorkflowTextForSend(trimmed, limit);
  if (truncated) {
    ctx.onLog?.(
      'warn',
      `[${preset.label || preset.id}] 输入文字 ${originalLength} 字，已按 ${limit} 字上限保留末尾后送模`,
      undefined
    );
  }
  return text;
}

async function executeGenerateVideoPath(
  preset: CustomAppModule,
  inputImageBase64: string,
  ctx: CapabilityExecuteContext,
  opts?: ExecuteCapabilityOptions
): Promise<CapabilityExecuteResult> {
  const start = Date.now();
  const actionLabel = preset.label || preset.id;
  const extra = opts?.inputImages?.filter((s) => hasUsableImageBase64(s)) ?? [];
  const primary = hasUsableImageBase64(inputImageBase64) ? inputImageBase64 : '';
  const refs: string[] = [];
  if (primary) refs.push(primary);
  for (const s of extra) {
    if (refs.length >= WORKFLOW_VIDEO_MAX_REF_IMAGES) break;
    if (!refs.includes(s)) refs.push(s);
  }
  const hasImg = refs.length > 0;
  const userT = clampInputTextForSend(
    opts?.inputText || '',
    'pre_image_understand',
    preset,
    ctx,
    refs.length
  );
  const presetInstr = (preset.instruction || '').trim();

  if (!hasImg && !userT && !presetInstr) {
    return { ok: false, kind: 'none', error: '生视频需要文字描述或参考图', durationMs: Date.now() - start };
  }

  let promptFinal: string;
  if (hasImg) {
    ctx.onLog?.('info', `[${actionLabel}] 整理生视频提示词…`, undefined);
    emitCapabilityRunProgress(ctx, `${actionLabel}：理解画面与预设中…`);
    const understood = await resolveCapabilityPrompt(preset, refs, userT, ctx);
    const base = (understood ?? presetInstr).trim();
    promptFinal = userT ? `${base}\n\n【用户补充】\n${userT}` : base;
  } else if (preset.skipUnderstand === true) {
    promptFinal = [presetInstr, userT].filter(Boolean).join('\n\n').trim();
  } else {
    ctx.onLog?.('info', `[${actionLabel}] 整理生视频提示词…`, undefined);
    const fused = await workflowChat(
      [
        {
          role: 'user',
          parts: [
            {
              text: `你是视频生成提示词助手。将「预设」与「用户文字」融合为一段简洁的**视频画面与镜头运动**描述（中文或英文均可，只输出正文）。\n\n【预设】\n${presetInstr || '(无)'}\n\n【用户文字】\n${userT || '(无)'}`,
            },
          ],
        },
      ],
      resolveTextModelForPreset(preset, ctx)
    );
    promptFinal = (fused || '').trim();
  }

  if (!promptFinal) {
    return { ok: false, kind: 'none', error: '未能生成有效的生视频提示词', durationMs: Date.now() - start };
  }

  ctx.onLog?.('info', `[${actionLabel}] 请求生视频（HTTP 桥）…`, undefined);
  emitCapabilityRunProgress(ctx, `${actionLabel}：生视频中（依赖后端）…`);

  try {
    const out = await workflowGenerateVideo({
      prompt: promptFinal,
      referenceImages: hasImg ? refs : undefined,
    });
    return {
      ok: true,
      kind: 'video',
      videoUrl: out.videoUrl,
      mimeType: out.mimeType,
      durationMs: Date.now() - start,
    };
  } catch (e) {
    if (e instanceof WorkflowVideoNotAvailableError) {
      return { ok: false, kind: 'none', error: e.message, durationMs: Date.now() - start };
    }
    throw e;
  }
}

async function executeGenTextPath(
  preset: CustomAppModule,
  imageRefs: string[],
  inputText: string | undefined,
  ctx: CapabilityExecuteContext
): Promise<CapabilityExecuteResult> {
  const start = Date.now();
  const actionLabel = preset.label || preset.id;
  const sys = (preset.instruction || '').trim() || '请根据用户输入完成任务，直接输出结果正文。';
  const refs = imageRefs.filter((s) => hasUsableImageBase64(s)).slice(0, GEN_TEXT_VISION_MAX_IMAGES);
  const sendKind: WorkflowTextSendBudgetKind =
    preset.category === 'image_to_text' ? 'image_to_text' : 'text_to_text';
  const userT = clampInputTextForSend(inputText || '', sendKind, preset, ctx, refs.length);
  const hasImg = refs.length > 0;
  if (preset.category === 'text_to_text') {
    if (hasImg) {
      return {
        ok: false,
        kind: 'none',
        error: '文生文能力请拖入文字卡（不要拖图片）',
        durationMs: Date.now() - start,
      };
    }
    if (!userT) {
      return {
        ok: false,
        kind: 'none',
        error: '文生文需要文字卡片内容',
        durationMs: Date.now() - start,
      };
    }
  }
  if (preset.category === 'image_to_text' && !hasImg) {
    return {
      ok: false,
      kind: 'none',
      error: '图生文需要图片',
      durationMs: Date.now() - start,
    };
  }
  if (!hasImg && !userT) {
    return {
      ok: false,
      kind: 'none',
      error: '需要文字卡片内容或图片',
      durationMs: Date.now() - start,
    };
  }
  ctx.onLog?.('info', `[${actionLabel}] 文字模型处理中…`, undefined);
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
  for (const img of refs) {
    parts.push({ inlineData: parseInlineForLlm(img) });
  }
  const body = [
    `【系统任务】\n${sys}`,
    userT && `【用户文字】\n${userT}`,
    hasImg && (refs.length > 1 ? '【附图】请结合上述多张图片完成上述任务。' : '【附图】请结合图片完成上述任务。'),
  ]
    .filter(Boolean)
    .join('\n\n');
  parts.push({ text: body });
  try {
    const text = await workflowChat([{ role: 'user', parts }], resolveTextModelForPreset(preset, ctx));
    const out = (text || '').trim();
    if (!out) return { ok: false, kind: 'none', error: '文字模型未返回内容', durationMs: Date.now() - start };
    return { ok: true, kind: 'text', text: out, durationMs: Date.now() - start };
  } catch (e) {
    const msg = normalizeApiErrorMessage(e);
    logCapabilityRawError(ctx, actionLabel, e, msg);
    return { ok: false, kind: 'none', error: msg, durationMs: Date.now() - start };
  }
}

function logCapabilityRawError(
  ctx: CapabilityExecuteContext,
  actionLabel: string,
  e: unknown,
  normalizedMsg: string
): void {
  const rawMsg = e instanceof Error ? e.message : String(e);
  if (rawMsg && rawMsg !== normalizedMsg) {
    ctx.onLog?.('warn', `[${actionLabel}] 原始错误`, rawMsg.slice(0, 500));
  }
}

function capabilityStepErrorMessage(step: AiPipelineStep, e: unknown): string {
  if (isAiPipelineStepError(e)) return e.message;
  return formatAiPipelineStepError(step, normalizeApiErrorMessage(e));
}

export type ExecuteCapabilityOptions = {
  /** 来自文字资产卡片的正文 */
  inputText?: string;
  /**
   * 多参考图（须与主 `inputImageBase64` 同序；首图应与主参一致）。
   * 生图/图生文等路径在多于 1 张时走多图 API。
   */
  inputImages?: string[];
  /** 生图/理解前正文截断预算；分镜拼图等长提示可设为 `understand` */
  textSendBudgetKind?: WorkflowTextSendBudgetKind;
  /** 覆盖文生图/图生图的 systemInstruction 模板（须含 `{instruction}` 占位） */
  imageSystemPrompt?: string;
  /** 为 true 时：正文超过送模上限则拒绝执行，不截断 */
  rejectTextTruncation?: boolean;
} & GeminiImageBatchGroupOptions;

async function executeCompanionSamSegmentCapability(
  preset: CustomAppModule,
  inputImageBase64: string,
  ctx: CapabilityExecuteContext,
  start: number
): Promise<CapabilityExecuteResult> {
  const projectId = ctx.companionProjectId?.trim();
  const assetId = ctx.workflowAssetId?.trim();
  const actionLabel = preset.label || preset.id;
  if (!projectId) {
    return {
      ok: false,
      kind: 'none',
      error: '未选择工作区项目，无法使用本机智能分割',
      durationMs: Date.now() - start,
    };
  }
  if (!assetId) {
    return {
      ok: false,
      kind: 'none',
      error: '本机智能分割需要工作流资产上下文（请从工作区侧栏拖图到该能力执行，勿在能力集合内单独跑该节点）',
      durationMs: Date.now() - start,
    };
  }
  if (!hasUsableImageBase64(inputImageBase64)) {
    return { ok: false, kind: 'none', error: '需要有效的图片输入', durationMs: Date.now() - start };
  }
  let dataUrl = inputImageBase64.trim();
  if (!/^data:/i.test(dataUrl)) {
    const p = parseInlineForLlm(dataUrl);
    dataUrl = `data:${p.mimeType};base64,${p.data}`;
  }
  const { naturalSizeFromImageDataUrl, runSamSegmentFromDataUrl } = await import('./lightboxSamSegment');
  const size = await naturalSizeFromImageDataUrl(dataUrl);
  if (!size) {
    return { ok: false, kind: 'none', error: '无法读取图像尺寸', durationMs: Date.now() - start };
  }
  const pick = {
    ix: Math.floor(size.w / 2),
    iy: Math.floor(size.h / 2),
    nw: size.w,
    nh: size.h,
  };
  const resultKey = `ac_internal_sam_${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '').slice(0, 14) : `${Date.now().toString(36)}`}`;
  const displayKey = (ctx.workflowSourceDisplayKey || 'original').trim() || 'original';
  ctx.onLog?.('info', `[${actionLabel}] 本机分割（图像中心提示点）…`, undefined);
  emitCapabilityRunProgress(ctx, `${actionLabel}：本机分割中…`);
  const run = await runSamSegmentFromDataUrl({
    projectId,
    assetId,
    displayKey,
    dataUrl,
    pick,
    resultKey,
  });
  if (run.ok === false) {
    return { ok: false, kind: 'none', error: run.error, durationMs: Date.now() - start };
  }
  emitCapabilityRunProgress(ctx, `${actionLabel}：分割完成`);
  return {
    ok: true,
    kind: 'image',
    image: run.resultDataUrl,
    durationMs: Date.now() - start,
  };
}

async function executeCompanionRembgCapability(
  preset: CustomAppModule,
  inputImageBase64: string,
  ctx: CapabilityExecuteContext,
  start: number
): Promise<CapabilityExecuteResult> {
  const projectId = ctx.companionProjectId?.trim();
  const assetId = ctx.workflowAssetId?.trim();
  const actionLabel = preset.label || preset.id;
  if (!projectId) {
    return {
      ok: false,
      kind: 'none',
      error: '未选择工作区项目，无法使用本机去背景',
      durationMs: Date.now() - start,
    };
  }
  if (!assetId) {
    return {
      ok: false,
      kind: 'none',
      error: '本机去背景需要工作流资产上下文（请从工作区侧栏拖图到该能力执行）',
      durationMs: Date.now() - start,
    };
  }
  if (!hasUsableImageBase64(inputImageBase64)) {
    return { ok: false, kind: 'none', error: '需要有效的图片输入', durationMs: Date.now() - start };
  }
  let dataUrl = inputImageBase64.trim();
  if (!/^data:/i.test(dataUrl)) {
    const p = parseInlineForLlm(dataUrl);
    dataUrl = `data:${p.mimeType};base64,${p.data}`;
  }
  const resultKey = `ac_internal_rembg_${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '').slice(0, 14) : `${Date.now().toString(36)}`}`;
  const displayKey = (ctx.workflowSourceDisplayKey || 'original').trim() || 'original';
  ctx.onLog?.('info', `[${actionLabel}] 本机去背景（rembg）…`, undefined);
  emitCapabilityRunProgress(ctx, `${actionLabel}：本机去背景中…`);
  const rembgParams = readRemoveBgParams(preset);
  const { runLightboxRembgFromDataUrl } = await import('./lightboxRembg');
  const run = await runLightboxRembgFromDataUrl({
    projectId,
    assetId,
    displayKey,
    dataUrl,
    resultKey,
    model: rembgParams.model ?? preset.companionRembgModel,
    alphaMatting: rembgParams.alphaMatting || preset.companionRembgAlphaMatting === true,
  });
  if (run.ok === false) {
    return { ok: false, kind: 'none', error: run.error, durationMs: Date.now() - start };
  }
  emitCapabilityRunProgress(ctx, `${actionLabel}：去背景完成`);
  return {
    ok: true,
    kind: 'image',
    image: run.resultDataUrl,
    durationMs: Date.now() - start,
  };
}

async function executeSplitComponentCapability(
  preset: CustomAppModule,
  inputImageBase64: string,
  inputText: string | undefined,
  ctx: CapabilityExecuteContext,
  opts: ExecuteCapabilityOptions | undefined,
  start: number
): Promise<CapabilityExecuteResult> {
  const engine = getCapabilityEngine(preset);
  const actionLabel = preset.label || preset.id;
  const visionInput = await normalizeDataUrlForVisionApi(inputImageBase64);
  ctx.onLog?.('info', `[${actionLabel}] 识别物体中…`, undefined);
  emitCapabilityRunProgress(ctx, `${actionLabel}：检测物体中（视觉模型，可能需数十秒）…`);
  const boxes = await detectObjectsInImage(
    visionInput,
    resolveTextModelForPreset(preset, ctx),
    DEFAULT_PROMPTS.detect_blocks
  );
  if (!boxes.length) {
    return { ok: false, kind: 'none', error: '未识别到区域', durationMs: Date.now() - start };
  }
  const b = boxes.reduce((best, current) => {
    const bestArea = Math.max(0, best.xmax - best.xmin) * Math.max(0, best.ymax - best.ymin);
    const currentArea = Math.max(0, current.xmax - current.xmin) * Math.max(0, current.ymax - current.ymin);
    return currentArea > bestArea ? current : best;
  });
  const img = new Image();
  img.src = visionInput;
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = rej;
  });
  const scaleX = img.naturalWidth / 1000;
  const scaleY = img.naturalHeight / 1000;
  const x = Math.max(0, b.xmin * scaleX);
  const y = Math.max(0, b.ymin * scaleY);
  const w = Math.min(img.naturalWidth - x, (b.xmax - b.xmin) * scaleX);
  const h = Math.min(img.naturalHeight - y, (b.ymax - b.ymin) * scaleY);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const c2d = canvas.getContext('2d')!;
  c2d.drawImage(img, x, y, w, h, 0, 0, w, h);
  const cropped = canvas.toDataURL('image/png');
  emitCapabilityRunProgress(ctx, `${actionLabel}：已裁剪最大区域，准备后续步骤…`);

  if (engine === 'gen_image') {
    emitCapabilityRunProgress(ctx, `${actionLabel}：理解提示词中…`);
    const prompt = await resolveGenImagePrompt(preset, [cropped], (inputText || '').trim(), ctx);
    if (!prompt) {
      return {
        ok: false,
        kind: 'none',
        error: '该能力为生图执行方式，但未填写预设提示词或理解未返回有效指令',
        durationMs: Date.now() - start,
      };
    }
    ctx.onLog?.('info', `[${actionLabel}] 生图中…`, undefined);
    emitCapabilityRunProgress(ctx, `${actionLabel}：生图中…`);
    const modelId = resolveImageModelIdFromPreset(preset);
    const imageOptions =
      preset.imageAspectRatio || preset.imageSize
        ? { aspectRatio: preset.imageAspectRatio, imageSize: preset.imageSize }
        : undefined;
    const result = await workflowGenerateImage(cropped, prompt, modelId, imageOptions, undefined, undefined, {
      ...(opts?.batchGroupKey ? { batchGroupKey: opts.batchGroupKey } : {}),
      ...(opts?.batchGroupExpected ? { batchGroupExpected: opts.batchGroupExpected } : {}),
    });
    return {
      ok: true,
      kind: 'image',
      image: result || cropped,
      durationMs: Date.now() - start,
      vgpSteps: [makeVgpCapture(preset, prompt, modelId)],
    };
  }

  emitCapabilityRunProgress(ctx, `${actionLabel}：裁剪完成（未接生图）`);
  return { ok: true, kind: 'image', image: cropped, durationMs: Date.now() - start };
}

async function executeImageProcessByProcessor(
  processorId: ImageProcessorId,
  preset: CustomAppModule,
  inputImageBase64: string,
  ctx: CapabilityExecuteContext,
  opts: ExecuteCapabilityOptions | undefined,
  start: number
): Promise<CapabilityExecuteResult | null> {
  switch (processorId) {
    case 'host_bundle':
      return executeCompanionHostBundleCapability(preset, ctx, start);
    case 'sam_segment':
      return executeCompanionSamSegmentCapability(preset, inputImageBase64, ctx, start);
    case 'remove_bg':
      return executeCompanionRembgCapability(preset, inputImageBase64, ctx, start);
    case 'split_component':
      return executeSplitComponentCapability(preset, inputImageBase64, opts?.inputText, ctx, opts, start);
    case 'cut_image':
      return {
        ok: false,
        kind: 'none',
        error: '切割图片需要在工作流中执行（支持多图入组）',
        durationMs: Date.now() - start,
      };
    default:
      return null;
  }
}

async function executeCompanionHostBundleCapability(
  preset: CustomAppModule,
  ctx: CapabilityExecuteContext,
  start: number
): Promise<CapabilityExecuteResult> {
  const dirName = (preset.companionHostBundle?.dirName ?? '').trim();
  if (!dirName) {
    return { ok: false, kind: 'none', error: '未配置宿主包目录名', durationMs: Date.now() - start };
  }
  const phase = preset.companionHostBundle?.phase === 'probe' ? 'probe' : 'exec';
  const base = normalizeCompanionBaseUrl(getCompanionLocalBaseUrl());
  const actionLabel = preset.label || preset.id;
  const projectId = ctx.companionProjectId?.trim() || undefined;
  ctx.onLog?.(
    'info',
    `[${actionLabel}] 向本机伴侣提交 host_bundle.${phase}（${dirName}）…`,
    projectId ? `projectId=${projectId}` : undefined
  );
  emitCapabilityRunProgress(ctx, `本机伴侣：提交 ${phase}（${dirName}）…`);
  const submit =
    phase === 'probe'
      ? await submitCompanionHostBundleProbeJob(base, dirName, { projectId })
      : await submitCompanionHostBundleExecJob(base, dirName, { projectId });
  if (submit.ok === false) {
    return { ok: false, kind: 'none', error: submit.error, durationMs: Date.now() - start };
  }
  const jobIdRaw =
    submit.data && typeof submit.data === 'object' && submit.data !== null && 'jobId' in submit.data
      ? (submit.data as { jobId?: unknown }).jobId
      : undefined;
  const jobId = typeof jobIdRaw === 'string' ? jobIdRaw : '';
  ctx.onLog?.(
    'info',
    `[${actionLabel}] 已提交 jobId=${jobId || '（未知）'}，可在「设置 → 本地伴侣 → 任务进度」查看`,
    undefined
  );
  return {
    ok: true,
    kind: 'text',
    text: `已提交本机任务 ${jobId || '（未知 id）'}（host_bundle.${phase}，包「${dirName}」）。请在设置页「任务进度」查看结果。`,
    durationMs: Date.now() - start,
  };
}

/**
 * 执行能力：生图 / 文字 / 内置图像处理。切割图片等“多图输出/交互选择”的能力不在此处理。
 */
export async function executeCapability(
  preset: CustomAppModule,
  inputImageBase64: string,
  ctx: CapabilityExecuteContext = {},
  opts?: ExecuteCapabilityOptions
): Promise<CapabilityExecuteResult> {
  const start = Date.now();
  const actionLabel = preset.label || preset.id;
  const inputText = opts?.inputText;
  try {
    if (preset.category === 'generate_3d') {
      return { ok: false, kind: 'none', error: '生成3D 请在工作流中拖图到能力框提交', durationMs: Date.now() - start };
    }

    if (preset.category === 'generate_video') {
      return executeGenerateVideoPath(preset, inputImageBase64, ctx, opts);
    }

    if (isImageProcessPreset(preset)) {
      const processorId = resolveImageProcessorId(preset);
      if (processorId) {
        const processorResult = await executeImageProcessByProcessor(
          processorId,
          preset,
          inputImageBase64,
          ctx,
          opts,
          start
        );
        if (processorResult) return processorResult;
      }
    }

    const engine = getCapabilityEngine(preset);

    if (engine === 'gen_text') {
      const extra = opts?.inputImages?.filter((s) => hasUsableImageBase64(s)) ?? [];
      const primary = hasUsableImageBase64(inputImageBase64) ? inputImageBase64 : '';
      const merged: string[] = [];
      if (primary) merged.push(primary);
      for (const s of extra) {
        if (merged.length >= GEN_TEXT_VISION_MAX_IMAGES) break;
        if (!merged.includes(s)) merged.push(s);
      }
      return executeGenTextPath(preset, merged, inputText, ctx);
    }

    if (engine !== 'gen_image') {
      return { ok: false, kind: 'none', error: '该能力为图像处理执行方式，但没有内置实现', durationMs: Date.now() - start };
    }

    const primaryOk = hasUsableImageBase64(inputImageBase64);
    const extras = opts?.inputImages?.filter((s) => hasUsableImageBase64(s)) ?? [];
    const hasImg = primaryOk || extras.length > 0;
    const refCount =
      (primaryOk ? 1 : 0) + extras.filter((s) => !primaryOk || s !== inputImageBase64).length;
    const textSendBudgetKind = opts?.textSendBudgetKind ?? 'pre_image_understand';
    const rawInputText = String(inputText || '').trim();
    if (opts?.rejectTextTruncation && rawInputText) {
      const limit = resolveWorkflowTextSendLimit(textSendBudgetKind, {
        modelFamily: textFamilyForPreset(preset, ctx),
        referenceImageCount: refCount,
      });
      const { truncated, originalLength } = clampWorkflowTextForSend(rawInputText, limit);
      if (truncated) {
        return {
          ok: false,
          kind: 'none',
          error: `输入文字 ${originalLength} 字，超过送模上限 ${limit} 字，已拒绝执行（不会截断后代为生成）`,
          durationMs: Date.now() - start,
        };
      }
    }
    const userT = opts?.rejectTextTruncation
      ? rawInputText
      : clampInputTextForSend(inputText || '', textSendBudgetKind, preset, ctx, refCount);

    if (preset.category === 'text_to_image' && hasImg) {
      return {
        ok: false,
        kind: 'none',
        error: '文生图能力请拖入文字卡，不要拖图片',
        durationMs: Date.now() - start,
      };
    }

    if (!hasImg) {
      if (preset.category === 'image_to_image') {
        return {
          ok: false,
          kind: 'none',
          error: '图生图需要图片（请拖入图片卡）',
          durationMs: Date.now() - start,
        };
      }
      const prompt = await resolveTextOnlyImagePrompt(
        preset,
        userT,
        ctx,
        textSendBudgetKind,
        opts?.rejectTextTruncation === true
      );
      if (!prompt) {
        return {
          ok: false,
          kind: 'none',
          error: '文生图需要预设提示词，或勾选「理解」并提供文字卡片内容',
          durationMs: Date.now() - start,
        };
      }
      ctx.onLog?.('info', `[${actionLabel}] 文生图中…`, undefined);
      const modelId = resolveImageModelIdFromPreset(preset);
      const imageOptions =
        preset.imageAspectRatio || preset.imageSize
          ? { aspectRatio: preset.imageAspectRatio, imageSize: preset.imageSize }
          : undefined;
      const result = await workflowGenerateImage(
        null,
        prompt,
        modelId,
        imageOptions,
        opts?.imageSystemPrompt,
        undefined,
        {
          ...(opts?.batchGroupKey ? { batchGroupKey: opts.batchGroupKey } : {}),
          ...(opts?.batchGroupExpected ? { batchGroupExpected: opts.batchGroupExpected } : {}),
        }
      );
      return {
        ok: true,
        kind: 'image',
        image: result,
        durationMs: Date.now() - start,
        vgpSteps: [makeVgpCapture(preset, prompt, modelId)],
      };
    }

    const rawList = mergePrimaryAndReferenceImageUrls(
      primaryOk ? inputImageBase64 : '',
      extras
    );
    const maxRef = maxReferenceImagesForImageModel(
      preset.imageModelRegistryId ?? preset.imageGear
    );
    const refs = rawList.slice(0, maxRef);
    if (refs.length === 0) {
      return {
        ok: false,
        kind: 'none',
        error: '图生图需要有效图片',
        durationMs: Date.now() - start,
      };
    }

    const runUnderstand = shouldRunCapabilityUnderstand(preset, { userText: userT });
    const pipelineSteps = planCapabilityPipelineSteps(preset, { runUnderstand });
    const stepTotal = pipelineSteps.length;
    let stepIndex = 0;
    const emitStep = (message: string) => {
      stepIndex += 1;
      emitCapabilityRunProgress(ctx, message, { stepIndex, stepTotal });
    };

    emitStep(
      runUnderstand
        ? `${actionLabel}：理解图片与提示词中…`
        : `${actionLabel}：准备生图（直发）…`
    );
    let prompt: string | null;
    try {
      prompt = await resolveGenImagePrompt(preset, refs, userT, ctx);
    } catch (e) {
      const msg = capabilityStepErrorMessage('understand', e);
      logCapabilityRawError(ctx, actionLabel, e, msg);
      return { ok: false, kind: 'none', error: msg, durationMs: Date.now() - start };
    }
    if (!prompt) {
      return {
        ok: false,
        kind: 'none',
        error: '该能力为生图执行方式，但未填写预设提示词或理解未返回有效指令',
        durationMs: Date.now() - start,
      };
    }
    const augmented = prompt;
    ctx.onLog?.('info', `[${actionLabel}] 生图中…`, undefined);
    emitStep(`${actionLabel}：生图中（可能较慢）…`);
    const modelId = resolveImageModelIdFromPreset(preset);
    const imageOptions = (preset.imageAspectRatio || preset.imageSize) ? { aspectRatio: preset.imageAspectRatio, imageSize: preset.imageSize } : undefined;
    const batchOpts = {
      ...(opts?.batchGroupKey ? { batchGroupKey: opts.batchGroupKey } : {}),
      ...(opts?.batchGroupExpected ? { batchGroupExpected: opts.batchGroupExpected } : {}),
    };
    let result: string;
    try {
      if (refs.length >= 2) {
        ctx.onLog?.('info', `[${actionLabel}] 多参考图生图中（${refs.length} 张）…`, undefined);
        emitStep(`${actionLabel}：多参考图生图中（${refs.length} 张）…`);
        result = await workflowGenerateImageMultiRefs(refs, augmented, modelId, imageOptions);
      } else {
        result = await workflowGenerateImage(refs[0]!, augmented, modelId, imageOptions, undefined, undefined, batchOpts);
      }
    } catch (e) {
      const msg = capabilityStepErrorMessage('image_create', e);
      logCapabilityRawError(ctx, actionLabel, e, msg);
      return { ok: false, kind: 'none', error: msg, durationMs: Date.now() - start };
    }
    return {
      ok: true,
      kind: 'image',
      image: result,
      durationMs: Date.now() - start,
      vgpSteps: [makeVgpCapture(preset, augmented, modelId)],
    };
  } catch (e) {
    if (e instanceof RangeError || /maximum call stack size exceeded/i.test(String((e as Error)?.message ?? e))) {
      try {
        if (import.meta.env.DEV) {
          console.error('[assetcutter] 能力执行栈溢出（请把完整 stack 发给开发）', e);
        }
      } catch {
        /* ignore */
      }
    }
    const msg = normalizeApiErrorMessage(e);
    logCapabilityRawError(ctx, actionLabel, e, msg);
    return { ok: false, kind: 'none', error: msg, durationMs: Date.now() - start };
  }
}

export type CapabilitySetExecuteContext = CapabilityExecuteContext & {
  presets: CustomAppModule[];
  /**
   * 资产输入节点可用的图片映射（key=nodeId）。
   * 主要用于画布内运行测试时，从工作区/仓库选中的资产喂给流程。
   */
  assetInputs?: Record<string, string | undefined>;
  /**
   * 资产输入节点可用的文字映射（key=nodeId），与 `assetInputs` 互斥（同一节点优先文本）。
   * 用于工作区文字卡接入能力集合。
   */
  assetInputTexts?: Record<string, string | undefined>;
  /**
   * 若设置：执行到该测试断点节点并完成其透传后**立即返回**（不跑下游），用于画布「运行测试」。
   */
  stopAtNodeId?: string;
  /** 每完成一个节点的图像输出后回调（用于画布逐步刷新预览） */
  onNodeImageOutput?: (nodeId: string, image: string) => void;
};

export function validateCapabilitySetGraph(set: CapabilitySet, presets: CustomAppModule[]): string | null {
  const inputNodes = set.nodes.filter((n) => n.type === 'input');
  const assetInputNodes = set.nodes.filter((n) => n.type === 'assetInput');
  const outputNodes = set.nodes.filter((n) => n.type === 'output');
  if (inputNodes.length > 1) return '能力集合最多只能有 1 个「原始输入」节点';
  if (inputNodes.length === 0 && assetInputNodes.length === 0) {
    return '能力集合需要 1 个原始输入节点或至少 1 个资产输入节点';
  }
  if (outputNodes.length < 1) return '能力集合至少需要 1 个输出节点';

  for (const node of set.nodes) {
    if (node.type !== 'preset') continue;
    if (!node.data.presetId) return `节点「${node.data.label || node.id}」缺少预设绑定`;
    if (!presets.some((preset) => preset.id === node.data.presetId)) {
      return `节点「${node.data.label || node.id}」引用了不存在的预设`;
    }
  }

  const inByTarget = new Map<string, number>();
  const outBySource = new Map<string, number>();
  for (const e of set.edges) {
    inByTarget.set(e.target, (inByTarget.get(e.target) ?? 0) + 1);
    outBySource.set(e.source, (outBySource.get(e.source) ?? 0) + 1);
  }
  for (const n of set.nodes) {
    if (n.type !== 'testStop') continue;
    const inc = inByTarget.get(n.id) ?? 0;
    const outc = outBySource.get(n.id) ?? 0;
    if (inc < 1 || outc < 1) {
      return `测试断点「${n.data.label || n.id}」需至少一条入边与一条出边`;
    }
  }

  return null;
}

/** 能力集合内 AI 节点数 × 单步价目表上限（先预扣费，避免分段执行中途积分不足） */
export function estimateCapabilitySetCredits(set: CapabilitySet, presets: CustomAppModule[]): number {
  return sumPlatformMinCredits(planCapabilitySetRoutes(set, presets));
}

/** 单能力预设先预扣估算（图生图/变体等含理解步时叠加 understand + image） */
export function estimateSingleCapabilityPrecharge(
  module: CustomAppModule | null | undefined,
  _branch: string,
  overrides?: CapabilityCreditOverrides
): number {
  if (!module) return sumPlatformMinCredits([]);
  return sumPlatformMinCredits(planCapabilityModuleRoutes(module, overrides));
}

/**
 * 从图中移除测试断点节点并将边桥接，使执行等价于「连线不经过测试点」。
 * @param exceptTestStopId 若设置且为图中 `testStop`：保留该节点（用于「在该测试点运行测试」）；否则移除全部测试点。
 */
export function collapseTestStopsForExecution(
  set: CapabilitySet,
  exceptTestStopId: string | null
): CapabilitySet {
  let nodes = [...set.nodes];
  let edges = set.edges.map((e) => ({ ...e }));

  const shouldRemove = (tid: string) => {
    const n = nodes.find((x) => x.id === tid);
    if (!n || n.type !== 'testStop') return false;
    if (exceptTestStopId && tid === exceptTestStopId) return false;
    return true;
  };

  let guard = 0;
  while (guard++ < 256) {
    const victim = nodes.find((n) => shouldRemove(n.id));
    if (!victim) break;
    const tid = victim.id;
    const preds = edges.filter((e) => e.target === tid);
    const succs = edges.filter((e) => e.source === tid);
    edges = edges.filter((e) => e.source !== tid && e.target !== tid);
    if (preds.length > 0 && succs.length > 0) {
      for (const p of preds) {
        for (const s of succs) {
          if (p.source === s.target) continue;
          const exists = edges.some((e) => e.source === p.source && e.target === s.target);
          if (exists) continue;
          const bridge: CapabilitySetEdge = {
            id: `bridge-${p.source}-${s.target}-${Math.random().toString(36).slice(2, 10)}`,
            source: p.source,
            target: s.target,
            sourceHandle: p.sourceHandle ?? null,
            targetHandle: s.targetHandle ?? null,
          };
          edges.push(bridge);
        }
      }
    }
    nodes = nodes.filter((n) => n.id !== tid);
  }

  return { ...set, nodes, edges };
}

function capabilitySetFail(
  error: string,
  startMs: number,
  partial: Record<string, string>,
  failedNodeId?: string
): CapabilityExecuteResult {
  const keys = Object.keys(partial);
  const copy: Record<string, string> = {};
  for (const k of keys) copy[k] = partial[k];
  const base = {
    ok: false as const,
    kind: 'none' as const,
    error,
    durationMs: Date.now() - startMs,
    ...(failedNodeId ? { failedNodeId } : {}),
    ...(keys.length > 0 ? { nodeImageOutputs: copy } : {}),
  };
  return base;
}

/**
 * 执行能力集合：按图的拓扑顺序执行。支持多分支汇聚到生图模型（线稿+色块+文本生成 -> 生图模型）。
 */
export async function executeCapabilitySet(
  set: CapabilitySet,
  inputImage: string,
  ctx: CapabilitySetExecuteContext
): Promise<CapabilityExecuteResult> {
  const start = Date.now();
  const { presets, onLog } = ctx;
  const setVgpSteps: VgpGenStepCapture[] = [];
  const validationError = validateCapabilitySetGraph(set, presets);
  if (validationError) {
    return capabilitySetFail(validationError, start, {});
  }

  const rawNodeMap = new Map<string, CapabilitySetNode>(set.nodes.map((n) => [n.id, n]));
  const stopId = ctx.stopAtNodeId;
  const exceptTestStop =
    stopId && rawNodeMap.get(stopId)?.type === 'testStop' ? stopId : null;
  const effectiveSet = collapseTestStopsForExecution(set, exceptTestStop);

  ctx.onRunProgress?.(
    ctx.stopAtNodeId
      ? `校验通过，执行至所选节点（含该节点）…`
      : `校验通过，开始执行全流程（已自动跳过测试节点）…`
  );
  const nodeMap = new Map<string, CapabilitySetNode>(effectiveSet.nodes.map((n) => [n.id, n]));
  const execGraph = effectiveSet;
  const inEdges = new Map<string, string[]>();
  for (const e of execGraph.edges) {
    if (!inEdges.has(e.target)) inEdges.set(e.target, []);
    inEdges.get(e.target)!.push(e.source);
  }
  const outputs = new Map<string, string>();
  /** 节点输出的纯文本（文字卡资产输入、文生文预设等），供下游合并为 inputText */
  const upstreamTextByNodeId = new Map<string, string>();
  const nodeImageOutputs: Record<string, string> = {};
  const recordNodeImage = (nodeId: string, img: string) => {
    if (img && typeof img === 'string') {
      nodeImageOutputs[nodeId] = img;
      ctx.onNodeImageOutput?.(nodeId, img);
    }
  };
  const inputNode = execGraph.nodes.find((n) => n.type === 'input');
  if (inputNode) {
    outputs.set(inputNode.id, inputImage);
    recordNodeImage(inputNode.id, inputImage);
  }

  const done = new Set<string>(inputNode ? [inputNode.id] : []);
  let lastImage: string = inputImage;

  while (done.size < execGraph.nodes.length) {
    let progressed = false;
    for (const n of execGraph.nodes) {
      if (done.has(n.id)) continue;
      const sources = inEdges.get(n.id) ?? [];
      if (sources.some((s) => !done.has(s))) continue;

      if (n.type === 'preset' && n.data.presetId) {
        const preset = presets.find((p) => p.id === n.data.presetId);
        if (!preset) {
          onLog?.('warn', `[能力集合] 未找到预设 ${n.data.presetId}，跳过节点 ${n.data.label}`);
          ctx.onRunProgress?.(`跳过：未找到预设「${n.data.label || n.id}」`, { nodeId: n.id });
          done.add(n.id);
          progressed = true;
          continue;
        }
        ctx.onRunProgress?.(`正在执行：${n.data.label || preset.label || n.id}`, { nodeId: n.id });
        const imageSourceIds = sources.filter((s) => {
          const node = nodeMap.get(s);
          return node && (node.type === 'input' || node.type === 'preset' || node.type === 'assetInput');
        });
        const textGenSourceId = sources.find((s) => nodeMap.get(s)?.type === 'textGen');
        const imagesFromSources = imageSourceIds.map((id) => outputs.get(id)).filter(Boolean) as string[];
        const promptFromTextGen = textGenSourceId ? (nodeMap.get(textGenSourceId)?.data?.text ?? '').trim() : '';
        const textFromUpstreamNodes = sources
          .map((s) => upstreamTextByNodeId.get(s))
          .filter((t): t is string => Boolean(t?.trim()))
          .map((t) => t.trim());
        const combinedPrompt =
          [...textFromUpstreamNodes, promptFromTextGen].filter(Boolean).join('\n\n') || '';

        const isMultiInput =
          imagesFromSources.length > 1 ||
          (imagesFromSources.length >= 1 && combinedPrompt.length > 0);

        if (isMultiInput && getCapabilityEngine(preset) === 'gen_image') {
          const images = imagesFromSources.length > 0 ? imagesFromSources : [inputImage];
          const instruction =
            combinedPrompt || (preset.instruction ?? '').trim() || '根据以上参考图生成最终效果。';
          onLog?.('info', `[${execGraph.label}] ${n.data.label} 执行中（${images.length} 张图 + 提示词）…`, undefined);
          ctx.onRunProgress?.(`${n.data.label || preset.label || n.id}：多图生图中（${images.length} 张参考）…`, {
            nodeId: n.id,
          });
          const modelId = resolveImageModelIdFromPreset(preset);
          const imageOptions = (preset.imageAspectRatio || preset.imageSize) ? { aspectRatio: preset.imageAspectRatio, imageSize: preset.imageSize } : undefined;
          try {
            const result = await workflowGenerateImageMultiRefs(images, instruction, modelId, imageOptions);
            outputs.set(n.id, result);
            recordNodeImage(n.id, result);
            lastImage = result;
            setVgpSteps.push(
              makeVgpCapture(preset, instruction, modelId, `set-node:${n.id}`)
            );
          } catch (e) {
            const msg = normalizeApiErrorMessage(e);
            return capabilitySetFail(`[${n.data.label}] ${msg}`, start, nodeImageOutputs, n.id);
          }
        } else {
          const promptFromTextGenSingle = textGenSourceId
            ? (nodeMap.get(textGenSourceId)?.data?.text ?? '').trim()
            : '';
          const mergedInputTextParts: string[] = [];
          for (const s of sources) {
            const ut = upstreamTextByNodeId.get(s);
            if (ut?.trim()) mergedInputTextParts.push(ut.trim());
          }
          if (promptFromTextGenSingle) mergedInputTextParts.push(promptFromTextGenSingle);
          const mergedInputText =
            mergedInputTextParts.length > 0 ? mergedInputTextParts.join('\n\n') : undefined;

          const imageSrcIds = sources.filter((s) => {
            const v = outputs.get(s);
            return typeof v === 'string' && v.trim().length > 0 && hasUsableImageBase64(v);
          });
          const useGlobalInputFallback = Boolean(inputNode && sources.includes(inputNode.id));
          let srcImage = '';
          if (imageSrcIds.length > 0) {
            srcImage = outputs.get(imageSrcIds[0]!) ?? '';
          } else if (useGlobalInputFallback) {
            srcImage = inputImage;
          }

          onLog?.('info', `[${execGraph.label}] ${n.data.label} 执行中…`, undefined);
          const out = await executeCapability(
            preset,
            srcImage,
            { ...ctx, runProgressNodeId: n.id },
            mergedInputText ? { inputText: mergedInputText } : undefined
          );
          if (out.ok === false) {
            return capabilitySetFail(`[${n.data.label}] ${out.error}`, start, nodeImageOutputs, n.id);
          }
          if (out.kind === 'text') {
            upstreamTextByNodeId.set(n.id, out.text);
            outputs.set(n.id, '');
            done.add(n.id);
            progressed = true;
            continue;
          }
          if (out.kind === 'video') {
            return capabilitySetFail(
              `[${n.data.label}] 能力集合暂不支持生视频节点（请在工作流主区对单张卡片执行）`,
              start,
              nodeImageOutputs,
              n.id
            );
          }
          if (out.kind !== 'image') {
            return capabilitySetFail(
              `[${n.data.label}] 能力集合暂不支持该节点的纯文字输出，请在工作流单预设中执行`,
              start,
              nodeImageOutputs,
              n.id
            );
          }
          outputs.set(n.id, out.image);
          recordNodeImage(n.id, out.image);
          lastImage = out.image;
          if (out.vgpSteps?.length) {
            for (const s of out.vgpSteps) {
              setVgpSteps.push({ ...s, stepKey: `set-node:${n.id}` });
            }
          }
        }
      } else if (n.type === 'input') {
        ctx.onRunProgress?.('读取原始输入图…', { nodeId: n.id });
        outputs.set(n.id, inputImage);
        recordNodeImage(n.id, inputImage);
        lastImage = inputImage;
      } else if (n.type === 'assetInput') {
        ctx.onRunProgress?.(`读取资产输入：${n.data.label || n.id}`, { nodeId: n.id });
        const fromText = (ctx.assetInputTexts?.[n.id] ?? '').trim();
        const fromMap = (ctx.assetInputs?.[n.id] ?? '').trim();
        if (fromText) {
          upstreamTextByNodeId.set(n.id, fromText);
          outputs.set(n.id, '');
        } else if (fromMap) {
          outputs.set(n.id, fromMap);
          recordNodeImage(n.id, fromMap);
          lastImage = fromMap;
        } else {
          outputs.set(n.id, inputImage);
          recordNodeImage(n.id, inputImage);
          lastImage = inputImage;
        }
      } else if (n.type === 'output') {
        ctx.onRunProgress?.(`汇总输出：${n.data.label || n.id}`, { nodeId: n.id });
        if (!sources.length) {
          return capabilitySetFail(`输出节点「${n.data.label || n.id}」缺少输入`, start, nodeImageOutputs, n.id);
        }
        const srcId = sources.find((s) => {
          const v = outputs.get(s);
          return typeof v === 'string' && v.trim().length > 0 && hasUsableImageBase64(v);
        });
        if (!srcId) {
          return capabilitySetFail(
            `输出节点「${n.data.label || n.id}」未收到有效图像输入`,
            start,
            nodeImageOutputs,
            n.id
          );
        }
        const outputImage = outputs.get(srcId);
        if (!outputImage) {
          return capabilitySetFail(
            `输出节点「${n.data.label || n.id}」未收到有效图像输入`,
            start,
            nodeImageOutputs,
            n.id
          );
        }
        lastImage = outputImage;
        outputs.set(n.id, outputImage);
        recordNodeImage(n.id, outputImage);
        if (ctx.stopAtNodeId === n.id) {
          ctx.onRunProgress?.('已在输出节点停止，正在生成预览…', { nodeId: n.id });
          return {
            ok: true,
            kind: 'image',
            image: outputImage,
            durationMs: Date.now() - start,
            vgpSteps: setVgpSteps.length ? setVgpSteps : undefined,
            nodeImageOutputs,
          };
        }
      } else if (n.type === 'textGen') {
        done.add(n.id);
        progressed = true;
        continue;
      } else if (n.type === 'testStop') {
        ctx.onRunProgress?.(
          ctx.stopAtNodeId === n.id
            ? '到达测试节点，在此停止（不执行下游）…'
            : '经过测试节点（透传上游图像）…',
          { nodeId: n.id }
        );
        const srcId = sources.find((s) => outputs.has(s)) ?? sources[0];
        const img = (srcId ? outputs.get(srcId) : undefined) ?? inputImage;
        outputs.set(n.id, img);
        recordNodeImage(n.id, img);
        lastImage = img;
        done.add(n.id);
        progressed = true;
        if (ctx.stopAtNodeId === n.id) {
          ctx.onRunProgress?.('测试节点已完成，正在更新画布预览…', { nodeId: n.id });
          return {
            ok: true,
            kind: 'image',
            image: img,
            durationMs: Date.now() - start,
            vgpSteps: setVgpSteps.length ? setVgpSteps : undefined,
            nodeImageOutputs,
          };
        }
        continue;
      }
      done.add(n.id);
      progressed = true;
    }
    if (!progressed) {
      const blocked = execGraph.nodes
        .filter((n) => !done.has(n.id))
        .map((n) => n.data.label || n.id)
        .join('、');
      return capabilitySetFail(
        `能力集合无法继续执行，可能存在环路或缺少上游输入：${blocked}`,
        start,
        nodeImageOutputs
      );
    }
  }

  ctx.onRunProgress?.('全流程执行完毕，正在更新画布预览…');
  return {
    ok: true,
    kind: 'image',
    image: lastImage,
    durationMs: Date.now() - start,
    vgpSteps: setVgpSteps.length ? setVgpSteps : undefined,
    nodeImageOutputs: Object.keys(nodeImageOutputs).length > 0 ? nodeImageOutputs : {},
  };
}

