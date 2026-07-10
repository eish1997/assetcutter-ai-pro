/**
 * P0.5-a：项目 Agent / QuickCompose 侧栏空态·忙态·错误态文案与禁用原因（单一真源）。
 */

import type { QuickComposeMessageStatus } from '../../../types/quickComposeThread';

export const PROJECT_AGENT_EMPTY_TITLE = '跟项目里的 Agent 说话';
export const PROJECT_AGENT_EMPTY_HINT = '发送后会先给出计划，再在画布出活。可用 @ 引用资产或专家。';

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

/** 发送按钮禁用原因优先级：忙 > 积分/登录门禁 > 空草稿 */
export function resolveComposerSubmitDisabledReason(
  input: ComposerDisableReasonInput
): string | undefined {
  if (input.threadBusy) return COMPOSER_BUSY_HINT;
  if (input.creditsBlocked) return input.creditsReason?.trim() || undefined;
  if (input.draftEmpty) return COMPOSER_EMPTY_DRAFT_REASON;
  return undefined;
}
