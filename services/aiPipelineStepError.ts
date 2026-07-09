/**
 * 串行 AI 任务分步错误：每步固定 step + code，避免末尾统一映射成「Google 限流」等随机文案。
 * @see docs/错题本.md — 积分闸门后误报 429
 */

export type AiPipelineStep =
  | 'credits_bundle'
  | 'credits_gate'
  | 'understand'
  | 'image_create'
  | 'image_poll'
  | 'credits_release';

export const AI_PIPELINE_STEP_LABELS: Record<AiPipelineStep, string> = {
  credits_bundle: '积分预扣',
  credits_gate: '积分准入',
  understand: '理解步',
  image_create: '生图步',
  image_poll: '生图轮询',
  credits_release: '积分释放',
};

export class AiPipelineStepError extends Error {
  readonly step: AiPipelineStep;
  readonly code: string;

  constructor(step: AiPipelineStep, code: string, userMessage: string) {
    super(formatAiPipelineStepError(step, userMessage));
    this.name = 'AiPipelineStepError';
    this.step = step;
    this.code = code;
  }
}

export function formatAiPipelineStepError(step: AiPipelineStep, userMessage: string): string {
  const label = AI_PIPELINE_STEP_LABELS[step] || step;
  const msg = String(userMessage || '').trim();
  return msg.startsWith(`[${label}]`) ? msg : `[${label}] ${msg}`;
}

export function isAiPipelineStepError(err: unknown): err is AiPipelineStepError {
  return err instanceof AiPipelineStepError;
}

/** 从已格式化的 `[理解步] …` 等文案反查 step（供 normalize 保留前缀） */
export function detectPipelineStepFromMessage(raw: string): AiPipelineStep | null {
  const t = String(raw || '').trim();
  for (const [step, label] of Object.entries(AI_PIPELINE_STEP_LABELS) as [AiPipelineStep, string][]) {
    if (t.startsWith(`[${label}]`)) return step;
  }
  return null;
}

export type AiPipelineDevLogDetail = {
  step?: AiPipelineStep;
  code?: string;
  raw?: string;
  mapped?: string;
  reserveKey?: string | null;
  jobId?: string | null;
};

/** DEV：映射前后、reserveKey/jobId 可观测 */
export function logAiPipelineDev(event: 'error' | 'map', detail: AiPipelineDevLogDetail): void {
  try {
    if (!import.meta.env.DEV) return;
    const payload = {
      ...detail,
      raw: detail.raw != null ? String(detail.raw).slice(0, 400) : undefined,
      mapped: detail.mapped != null ? String(detail.mapped).slice(0, 240) : undefined,
    };
    console.warn(`[assetcutter][ai-pipeline] ${event}`, payload);
  } catch {
    /* ignore */
  }
}
