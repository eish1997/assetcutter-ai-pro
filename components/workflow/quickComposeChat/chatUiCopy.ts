/**
 * Project Agent / QuickCompose 侧栏空态、忙态、错误态文案与禁用原因。
 */

import type { QuickComposeMessageStatus } from '../../../types/quickComposeThread';
import type {
  AgentSuggestedActionConfirmLevel,
  AgentSuggestedActionConfirmation,
  AgentSuggestedActionRiskLevel,
  AgentSuggestedActionTargetScope,
} from '../../../types/quickComposeThread';

export const PROJECT_AGENT_EMPTY_SUGGESTIONS = [
  '帮我看一下当前项目下一步最该做什么',
  '检查选中资产是否统一，并给出处理建议',
  '把这批资产整理成可交付版本',
  '根据当前结果继续推进，先给我一个计划',
  '把这次操作整理成给同事看的说明',
];
export const PROJECT_AGENT_EMPTY_TITLE = '工作区 Agent';
export const PROJECT_AGENT_EMPTY_HINT = '说说你想完成什么，Agent 会读取当前项目、资产和选择，再给出下一步。';
export const BUSY_STATUS_LABEL: Record<
  Extract<QuickComposeMessageStatus, 'queued' | 'understanding' | 'running'>,
  string
> = {
  understanding: '理解中...',
  queued: '排队中...',
  running: '执行中...',
};

export const COMPOSER_BUSY_HINT = '助手处理中，完成后可继续发送';
export const COMPOSER_EMPTY_DRAFT_REASON = '请先输入内容';
export const CLEAR_CHAT_BUSY_REASON = '助手处理中，暂不能清空';

export const ERROR_FALLBACK = '没完成，可以重试、换个方式，或先只生成方案';
/** @deprecated 与 `QUICK_COMPOSE_CANCELLED_MESSAGE` 同文；气泡侧请直接用 turnContext 常量 */
export const ERROR_CANCELLED = '已取消';

export const FAILURE_RECOVERY_RETRY_ACTION = {
  id: 'retry',
  kind: 'retry',
  label: '重试',
} as const;

export const COST_ACTION_CONFIRM_COPY = '准备执行：此操作可能消耗积分或处理多个资产，确认继续？';
export const DESTRUCTIVE_ACTION_CONFIRM_COPY =
  '准备执行：此操作可能修改、覆盖或删除现有资产，确认继续？';
export const LIGHT_ACTION_CONFIRM_COPY = '确认执行这个动作？';
export const MEMORY_ACTION_CONFIRM_COPY =
  '确认把这次偏好、流程或资产规则保存为可管理记忆？后续可在记忆管理里查看和移除。';

export type QuickComposeChatActionLike = {
  kind?: string;
  type?: string;
  action?: string;
  label?: string;
  confirmLevel?: AgentSuggestedActionConfirmLevel | string;
  riskLevel?: AgentSuggestedActionRiskLevel | string;
  targetScope?: AgentSuggestedActionTargetScope | string;
  confirmation?: AgentSuggestedActionConfirmation;
  requiresConfirmation?: boolean;
  requiresCost?: boolean;
  cost?: unknown;
  costCredits?: number;
  estimatedItems?: number;
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

/** 发送按钮禁用原因优先级：忙 > 积分/登录门禁 > 空草稿 */
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

function actionTargetScopeLabel(action: QuickComposeChatActionLike): string {
  if (action.confirmation?.scope?.trim()) return action.confirmation.scope.trim();
  const count =
    typeof action.confirmation?.assetCount === 'number' && action.confirmation.assetCount > 0
      ? action.confirmation.assetCount
      : typeof action.estimatedItems === 'number' && action.estimatedItems > 0
        ? action.estimatedItems
        : undefined;
  if (action.targetScope === 'selected') {
    return count ? `当前选中 ${count} 个资产` : '当前选中资产';
  }
  if (action.targetScope === 'current') return '当前资产或当前结果';
  if (action.targetScope === 'group') return '当前资产组';
  if (action.targetScope === 'all') return '当前项目全部相关资产';
  return count ? `${count} 个资产` : '当前对话上下文';
}

function actionImpactLabel(action: QuickComposeChatActionLike): string {
  if (action.confirmation?.impact?.trim()) return action.confirmation.impact.trim();
  if (action.confirmation?.createsVersion) return '会创建新版本，不覆盖原内容';
  if (action.confirmLevel === 'destructive' || action.destructive || action.isDestructive) {
    return '可能修改、覆盖或删除现有资产';
  }
  if (action.confirmLevel === 'cost' || actionHasCost(action)) {
    return '会执行一次付费或批量处理动作';
  }
  if (action.kind === 'save_memory' || action.type === 'save_memory' || action.action === 'save_memory') {
    return '会保存为后续可管理的偏好或资产规则';
  }
  return '会按当前上下文执行这个动作';
}

function actionCostLabel(action: QuickComposeChatActionLike): string {
  if (action.confirmation?.cost?.trim()) return action.confirmation.cost.trim();
  if (typeof action.costCredits === 'number' && action.costCredits > 0) {
    return `约 ${action.costCredits} 积分`;
  }
  if (typeof action.cost === 'number' && action.cost > 0) {
    return `约 ${action.cost} 积分`;
  }
  if (action.confirmLevel === 'cost' || actionHasCost(action)) return '以执行时实际计费为准';
  return '不预计消耗积分';
}

function actionRecoverabilityLabel(action: QuickComposeChatActionLike): string {
  if (action.confirmation?.recoverability?.trim()) return action.confirmation.recoverability.trim();
  if (action.confirmLevel === 'destructive' || action.destructive || action.isDestructive) {
    return '执行前请确认已有备份或可撤销路径';
  }
  if (action.confirmation?.createsVersion || action.confirmLevel === 'cost') {
    return '默认保留原资产，失败后保留可恢复状态';
  }
  return '可在后续管理入口调整或移除';
}

export function quickComposeChatActionConfirmSummary(
  action: QuickComposeChatActionLike | null | undefined
): string | undefined {
  if (!action || !quickComposeChatActionNeedsConfirm(action)) return undefined;
  const lines = [
    '准备执行：',
    `范围：${actionTargetScopeLabel(action)}`,
    `影响：${actionImpactLabel(action)}`,
    `预计：${actionCostLabel(action)}`,
    `可恢复：${actionRecoverabilityLabel(action)}`,
  ];
  return lines.join('\n');
}

export function quickComposeChatActionNeedsConfirm(
  action: QuickComposeChatActionLike | null | undefined
): boolean {
  if (!action) return false;
  if (action.requiresConfirmation) return true;
  if (action.riskLevel === 'medium' || action.riskLevel === 'high') return true;
  if (
    action.confirmLevel === 'light' ||
    action.confirmLevel === 'cost' ||
    action.confirmLevel === 'destructive'
  ) {
    return true;
  }
  if (action.destructive || action.isDestructive) return true;
  return actionHasCost(action);
}

export function quickComposeChatActionConfirmCopy(
  action: QuickComposeChatActionLike | null | undefined
): string | undefined {
  if (!action || !quickComposeChatActionNeedsConfirm(action)) return undefined;
  const summary = quickComposeChatActionConfirmSummary(action);
  if (summary) return summary;
  if (action.confirmLevel === 'destructive') return DESTRUCTIVE_ACTION_CONFIRM_COPY;
  if (action.destructive || action.isDestructive) return DESTRUCTIVE_ACTION_CONFIRM_COPY;
  if (action.kind === 'save_memory' || action.type === 'save_memory' || action.action === 'save_memory') {
    return MEMORY_ACTION_CONFIRM_COPY;
  }
  if (action.confirmLevel === 'cost') return COST_ACTION_CONFIRM_COPY;
  if (actionHasCost(action)) return COST_ACTION_CONFIRM_COPY;
  return LIGHT_ACTION_CONFIRM_COPY;
}

