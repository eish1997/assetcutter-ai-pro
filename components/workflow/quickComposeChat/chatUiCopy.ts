/**
 * Project Agent / QuickCompose 侧栏空态、忙态、错误态文案与禁用原因。
 */

import type { QuickComposeMessageStatus } from '../../../types/quickComposeThread';

export const PROJECT_AGENT_EMPTY_SUGGESTIONS = [
  '把当前画面改成更适合电商主图的构图，保留主体材质',
  '基于这组参考图生成 3 个统一风格的详情页视觉方向',
  '检查当前项目里哪些素材适合做活动海报，并给出下一步',
  '把这张图扩展成 16:9 横版场景，补充自然光和环境细节',
  '帮我整理一个可执行的商品图优化清单',
];
export const PROJECT_AGENT_EMPTY_TITLE = '跟项目里的 Agent 说话';
export const PROJECT_AGENT_EMPTY_HINT = '发送后会先给出计划，再在画布出活。可用 @ 引用资产或专家。';
export const PROJECT_AGENT_CONTEXT_DETAILS_LABEL = 'Agent 已读取的上下文';
export const PROJECT_AGENT_CONTEXT_TARGET_LABEL = '目标';
export const PROJECT_AGENT_CONTEXT_STALE_LABEL = '可能已过期';
export const PROJECT_AGENT_CONTEXT_RISK_LABEL: Record<
  'cost' | 'batch' | 'destructive',
  string
> = {
  cost: '额度相关',
  batch: '批量操作',
  destructive: '会改动内容',
};

export const BUSY_STATUS_LABEL: Record<
  Extract<QuickComposeMessageStatus, 'queued' | 'understanding' | 'running'>,
  string
> = {
  understanding: '理解中…',
  queued: '排队中…',
  running: '生成中…',
};

export const COMPOSER_BUSY_HINT = '助手处理中，完成后可继续发送';
export const COMPOSER_EMPTY_DRAFT_REASON = '请先输入内容';
export const CLEAR_CHAT_BUSY_REASON = '助手处理中，暂不可清空';

export const ERROR_FALLBACK = '生成失败，可重试或换个说法';
/** @deprecated 与 `QUICK_COMPOSE_CANCELLED_MESSAGE` 同文；气泡侧请直接用 turnContext 常量 */
export const ERROR_CANCELLED = '已取消';

export const FAILURE_RECOVERY_RETRY_ACTION = {
  id: 'retry',
  kind: 'retry',
  label: '重试',
} as const;

export const COST_ACTION_CONFIRM_COPY = '此操作会消耗额度，确认继续？';
export const DESTRUCTIVE_ACTION_CONFIRM_COPY = '此操作会修改或删除现有内容，确认继续？';
export const LIGHT_ACTION_CONFIRM_COPY = '确认执行这个动作？';
export const MEMORY_ACTION_CONFIRM_COPY =
  '确认把这次风格、流程或偏好保存为可管理记忆？后续可以在记忆管理里查看和移除。';

export type QuickComposeChatActionLike = {
  kind?: string;
  type?: string;
  action?: string;
  requiresConfirmation?: boolean;
  requiresCost?: boolean;
  cost?: unknown;
  costCredits?: number;
  destructive?: boolean;
  isDestructive?: boolean;
};

export type QuickComposeFailureMessageLike = {
  status?: QuickComposeMessageStatus | string;
  errorMessage?: string;
};

export function isRunningAssistantStatus(
  status: QuickComposeMessageStatus | undefined
): status is 'queued' | 'understanding' | 'running' {
  return status === 'queued' || status === 'understanding' || status === 'running';
}

export function busyStatusLabel(status: QuickComposeMessageStatus | undefined): string {
  if (status === 'understanding' || status === 'queued' || status === 'running') {
    return BUSY_STATUS_LABEL[status];
  }
  return BUSY_STATUS_LABEL.running;
}

export type ComposerDisableReasonInput = {
  threadBusy: boolean;
  creditsBlocked: boolean;
  creditsReason?: string;
  draftEmpty: boolean;
};

export type ComposerCreditsHardBlockInput = {
  creditsBlocked: boolean;
  creditsBypass: boolean;
  userId?: string | null;
  balance?: number | null;
  balanceLoading: boolean;
};

/**
 * Agent chat should stay usable when local/dev balance service is unavailable.
 * Execution still performs the real reserve gate; this only avoids blocking the
 * lightweight conversation entry before the user can even submit.
 */
export function shouldHardBlockComposerCredits(input: ComposerCreditsHardBlockInput): boolean {
  if (!input.creditsBlocked || input.creditsBypass) return false;
  if (!String(input.userId ?? '').trim()) return true;
  if (input.balance != null) return true;
  return false;
}

/** 鍙戦€佹寜閽鐢ㄥ師鍥犱紭鍏堢骇锛氬繖 > 绉垎/鐧诲綍闂ㄧ > 绌鸿崏绋?*/
export function resolveComposerSubmitDisabledReason(
  input: ComposerDisableReasonInput
): string | undefined {
  if (input.threadBusy) return COMPOSER_BUSY_HINT;
  if (input.creditsBlocked) return input.creditsReason?.trim() || undefined;
  if (input.draftEmpty) return COMPOSER_EMPTY_DRAFT_REASON;
  return undefined;
}

export function resolveFailureRecoveryAction(
  message: QuickComposeFailureMessageLike | null | undefined
): typeof FAILURE_RECOVERY_RETRY_ACTION | undefined {
  if (!message) return undefined;
  if (message.status === 'error') return FAILURE_RECOVERY_RETRY_ACTION;
  if (typeof message.errorMessage === 'string' && message.errorMessage.trim()) {
    return FAILURE_RECOVERY_RETRY_ACTION;
  }
  return undefined;
}

function actionHasCost(action: QuickComposeChatActionLike): boolean {
  if (action.requiresCost) return true;
  if (typeof action.costCredits === 'number' && action.costCredits > 0) return true;
  return action.cost != null && action.cost !== false && action.cost !== 0;
}

export function quickComposeChatActionNeedsConfirm(
  action: QuickComposeChatActionLike | null | undefined
): boolean {
  if (!action) return false;
  if (action.requiresConfirmation) return true;
  if (action.destructive || action.isDestructive) return true;
  return actionHasCost(action);
}

export function quickComposeChatActionConfirmCopy(
  action: QuickComposeChatActionLike | null | undefined
): string | undefined {
  if (!action || !quickComposeChatActionNeedsConfirm(action)) return undefined;
  if (action.destructive || action.isDestructive) return DESTRUCTIVE_ACTION_CONFIRM_COPY;
  if (action.kind === 'save_memory' || action.type === 'save_memory' || action.action === 'save_memory') {
    return MEMORY_ACTION_CONFIRM_COPY;
  }
  if (actionHasCost(action)) return COST_ACTION_CONFIRM_COPY;
  return LIGHT_ACTION_CONFIRM_COPY;
}
