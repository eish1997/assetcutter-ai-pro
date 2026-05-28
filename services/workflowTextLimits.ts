import type { ModelFamily } from './modelRegistry/types';
import { textModelFamily } from './modelRegistry/textModels';

/** 文字资产正文存储上限（工作区 JSON / 云同步） */
export const WORKFLOW_TEXT_ASSET_BODY_MAX_CHARS = 32_000;

/** 编辑区黄色提示线 */
export const WORKFLOW_TEXT_WARN_CHARS = 6_000;

/** 入队执行前需用户确认的正文长度 */
export const WORKFLOW_TEXT_CONFIRM_CHARS = 12_000;

/** 文生文 / 理解链送模硬顶（GPT 友好默认值） */
export const WORKFLOW_TEXT_SEND_MAX_CHARS = 24_000;

/** 文生文 / 理解链送模硬顶（Gemini 家族可放宽） */
export const WORKFLOW_TEXT_SEND_MAX_CHARS_GEMINI = 48_000;

/** 图生文（含附图）送模硬顶 */
export const WORKFLOW_TEXT_VISION_SEND_MAX_CHARS = 12_000;

/** 生图 / 生视频前「用户段」送理解硬顶 */
export const WORKFLOW_TEXT_PRE_IMAGE_UNDERSTAND_MAX_CHARS = 8_000;

/** 多参考图时缩小文本预算的阈值与张数 */
export const WORKFLOW_TEXT_VISION_HEAVY_IMAGE_COUNT = 5;
export const WORKFLOW_TEXT_VISION_HEAVY_SCALE = 0.7;

export type WorkflowTextSendBudgetKind =
  | 'text_to_text'
  | 'image_to_text'
  | 'understand'
  | 'pre_image_understand';

const TRUNCATE_MARKER = '\n\n…（前文已截断，保留末尾指令）\n\n';

export function clampWorkflowTextBody(raw: string): string {
  if (raw.length <= WORKFLOW_TEXT_ASSET_BODY_MAX_CHARS) return raw;
  return raw.slice(0, WORKFLOW_TEXT_ASSET_BODY_MAX_CHARS);
}

export type WorkflowTextSendLimitOpts = {
  modelFamily?: ModelFamily;
  referenceImageCount?: number;
};

export function resolveWorkflowTextSendLimit(
  kind: WorkflowTextSendBudgetKind,
  opts?: WorkflowTextSendLimitOpts
): number {
  const family = opts?.modelFamily ?? 'gemini';
  const imgN = Math.max(0, Math.floor(opts?.referenceImageCount ?? 0));

  let base: number;
  switch (kind) {
    case 'image_to_text':
      base = WORKFLOW_TEXT_VISION_SEND_MAX_CHARS;
      break;
    case 'pre_image_understand':
      base = WORKFLOW_TEXT_PRE_IMAGE_UNDERSTAND_MAX_CHARS;
      break;
    case 'understand':
      base =
        family === 'openai' ? WORKFLOW_TEXT_SEND_MAX_CHARS : WORKFLOW_TEXT_SEND_MAX_CHARS_GEMINI;
      break;
    case 'text_to_text':
    default:
      base =
        family === 'openai' ? WORKFLOW_TEXT_SEND_MAX_CHARS : WORKFLOW_TEXT_SEND_MAX_CHARS_GEMINI;
      break;
  }

  if (kind === 'image_to_text' && imgN >= WORKFLOW_TEXT_VISION_HEAVY_IMAGE_COUNT) {
    return Math.max(2000, Math.floor(base * WORKFLOW_TEXT_VISION_HEAVY_SCALE));
  }
  return base;
}

export type ClampWorkflowTextForSendResult = {
  text: string;
  truncated: boolean;
  originalLength: number;
  limit: number;
};

/** 送模截断：优先保留末尾（用户任务描述常在文末） */
export function clampWorkflowTextForSend(text: string, maxChars: number): ClampWorkflowTextForSendResult {
  const raw = String(text ?? '');
  const limit = Math.max(0, Math.floor(maxChars));
  if (!raw || raw.length <= limit) {
    return { text: raw, truncated: false, originalLength: raw.length, limit };
  }
  if (limit <= 0) {
    return { text: '', truncated: raw.length > 0, originalLength: raw.length, limit };
  }
  const marker = TRUNCATE_MARKER;
  if (limit <= marker.length) {
    return {
      text: raw.slice(-limit),
      truncated: true,
      originalLength: raw.length,
      limit,
    };
  }
  const tailBudget = limit - marker.length;
  return {
    text: `${marker}${raw.slice(-tailBudget)}`,
    truncated: true,
    originalLength: raw.length,
    limit,
  };
}

export function workflowTextLengthTier(
  charCount: number
): 'ok' | 'warn' | 'confirm' {
  if (charCount >= WORKFLOW_TEXT_CONFIRM_CHARS) return 'confirm';
  if (charCount >= WORKFLOW_TEXT_WARN_CHARS) return 'warn';
  return 'ok';
}

/** 队列中任务正文最大长度（用于执行前确认） */
export function maxWorkflowPendingInputTextChars(
  tasks: ReadonlyArray<{ inputText?: string | null }>
): number {
  let max = 0;
  for (const t of tasks) {
    const n = String(t.inputText ?? '').trim().length;
    if (n > max) max = n;
  }
  return max;
}

export function resolveTextModelFamilyFromRegistryId(registryId: string): ModelFamily {
  return textModelFamily(registryId);
}
