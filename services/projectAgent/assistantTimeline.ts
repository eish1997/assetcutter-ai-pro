/**
 * P0.5-d：助手气泡步骤时间线 — 从消息 status + planSteps 派生，对齐 Trace 阶段语义。
 * 不另造状态机；不依赖完整 AgentTurnTrace 进 L1。
 */

import type {
  QuickComposeMessageStatus,
  QuickComposeThreadMessage,
} from '../../types/quickComposeThread';
import { QUICK_COMPOSE_CANCELLED_MESSAGE } from '../quickComposeTurnContext';

export type AssistantTimelineStepState = 'pending' | 'active' | 'done' | 'error' | 'skipped';

export type AssistantTimelineStep = {
  id: string;
  label: string;
  state: AssistantTimelineStepState;
};

export type AssistantTimelineModel = {
  steps: AssistantTimelineStep[];
  /** 进行中：展示完整时间线 + 取消 */
  inFlight: boolean;
  cancelled: boolean;
};

function parsePlanLabelsFromText(text: string): string[] {
  const raw = text.trim();
  const m = raw.match(/^计划[：:]\s*(.+)$/);
  if (!m) return [];
  const body = m[1]!.trim();
  if (!body || body === '无可用步骤' || body === '已提交') return [];
  if (body.includes(' → ')) {
    return body
      .split(/\s*→\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [body];
}

/** 从消息取工具步骤标签（优先 planSteps，回退计划句）。 */
export function resolveAssistantPlanLabels(
  message: Pick<QuickComposeThreadMessage, 'text' | 'planSteps'>
): string[] {
  const fromSteps = (message.planSteps ?? [])
    .map((s) => String(s.label || '').trim())
    .filter(Boolean);
  if (fromSteps.length) return fromSteps;
  return parsePlanLabelsFromText(message.text || '');
}

function isCancelledMessage(
  status: QuickComposeMessageStatus | undefined,
  errorMessage: string | undefined
): boolean {
  return status === 'error' && (errorMessage || '').trim() === QUICK_COMPOSE_CANCELLED_MESSAGE;
}

/**
 * 派生时间线：计划 → 排队 → 工具(们) → 完成。
 * 工具步进度用整 turn status 近似（当前 Trace.toolCalls 执行中亦不逐条回写）。
 */
export function deriveAssistantTimeline(
  message: Pick<QuickComposeThreadMessage, 'role' | 'status' | 'text' | 'errorMessage' | 'planSteps'>
): AssistantTimelineModel | null {
  if (message.role !== 'assistant') return null;

  const status = message.status;
  const cancelled = isCancelledMessage(status, message.errorMessage);
  const inFlight =
    status === 'queued' || status === 'understanding' || status === 'running';
  const terminalError = status === 'error' && !cancelled;
  const terminalDone = status === 'done';
  const terminal = terminalDone || terminalError || cancelled;

  // 无状态且无计划信息 → 不展示
  if (!status && !resolveAssistantPlanLabels(message).length) return null;

  const toolLabels = resolveAssistantPlanLabels(message);
  const tools =
    toolLabels.length > 0
      ? toolLabels
      : inFlight || terminal
        ? ['执行任务']
        : [];

  if (!tools.length && !status) return null;

  const steps: AssistantTimelineStep[] = [];

  // 1) 计划
  let planState: AssistantTimelineStepState = 'pending';
  if (inFlight || terminal) planState = 'done';
  else if (status === 'submitted') planState = 'active';
  steps.push({ id: 'plan', label: '制定计划', state: planState });

  // 2) 排队（理解并入排队/执行观感：understanding 时排队完成、工具 active）
  let queueState: AssistantTimelineStepState = 'pending';
  if (status === 'queued') queueState = 'active';
  else if (status === 'understanding' || status === 'running' || terminal) queueState = 'done';
  else if (cancelled || terminalError) queueState = 'skipped';
  steps.push({ id: 'queue', label: '排队', state: queueState });

  // 3) 工具步
  const toolCount = tools.length;
  tools.forEach((label, i) => {
    let state: AssistantTimelineStepState = 'pending';
    if (terminalDone) {
      state = 'done';
    } else if (cancelled) {
      // 取消：已开始的标 error，未开始 skipped
      if (status === 'queued') state = i === 0 ? 'error' : 'skipped';
      else state = i === 0 ? 'error' : 'skipped';
    } else if (terminalError) {
      state = i === toolCount - 1 ? 'error' : 'done';
    } else if (status === 'queued') {
      state = 'pending';
    } else if (status === 'understanding' || status === 'running') {
      // 多工具时无逐条回写：全部标 active 观感过重 → 首个 active，其余 pending
      state = i === 0 ? 'active' : 'pending';
    }
    steps.push({ id: `tool-${i}`, label, state });
  });

  // 4) 完成
  let finishState: AssistantTimelineStepState = 'pending';
  if (terminalDone) finishState = 'done';
  else if (cancelled || terminalError) finishState = 'error';
  steps.push({
    id: 'finish',
    label: cancelled ? '已取消' : terminalError ? '失败' : '完成',
    state: finishState,
  });

  return { steps, inFlight, cancelled };
}
