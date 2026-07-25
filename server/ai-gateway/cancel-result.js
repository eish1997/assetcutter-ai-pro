/**
 * B12: 统一取消结果契约。
 * - hard: 已请求上游取消 API
 * - soft: 仅本地标 cancelled，上游可能仍在跑
 */

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export const AI_GATEWAY_SOFT_CANCEL_REASON = 'upstream_hard_cancel_unavailable';

export const AI_GATEWAY_SOFT_CANCEL_USER_MESSAGE =
  '任务已在平台取消；上游暂不支持硬取消，远端任务可能仍会继续直至完成。';

export const AI_GATEWAY_SOFT_CANCEL_ADMIN_MESSAGE =
  'Soft cancel only — platform job marked cancelled; upstream hard cancel unavailable.';

export const AI_GATEWAY_HARD_CANCEL_USER_MESSAGE = '任务已取消，并已请求上游停止。';

export const AI_GATEWAY_HARD_CANCEL_ADMIN_MESSAGE = 'Hard cancel requested against upstream cancel API.';

/**
 * @param {{
 *   reason?: string,
 *   cancelReason?: string,
 *   userMessage?: string,
 *   adminMessage?: string,
 *   upstreamTaskId?: string | null,
 *   provider?: string | null,
 *   adapterId?: string | null,
 * }} [input]
 */
export function softAiGatewayCancelResult(input = {}) {
  const reason = nonEmptyString(input.reason) || AI_GATEWAY_SOFT_CANCEL_REASON;
  return {
    cancelled: false,
    mode: 'soft',
    reason,
    cancelReason: nonEmptyString(input.cancelReason) || reason,
    userMessage: nonEmptyString(input.userMessage) || AI_GATEWAY_SOFT_CANCEL_USER_MESSAGE,
    adminMessage: nonEmptyString(input.adminMessage) || AI_GATEWAY_SOFT_CANCEL_ADMIN_MESSAGE,
    upstreamTaskId: nonEmptyString(input.upstreamTaskId) || null,
    provider: nonEmptyString(input.provider) || null,
    adapterId: nonEmptyString(input.adapterId) || null,
  };
}

/**
 * @param {{
 *   reason?: string,
 *   cancelReason?: string,
 *   userMessage?: string,
 *   adminMessage?: string,
 *   upstreamTaskId?: string | null,
 *   provider?: string | null,
 *   adapterId?: string | null,
 *   httpStatus?: number | null,
 * }} [input]
 */
export function hardAiGatewayCancelResult(input = {}) {
  const reason = nonEmptyString(input.reason) || 'upstream_hard_cancel_requested';
  return {
    cancelled: true,
    mode: 'hard',
    reason,
    cancelReason: nonEmptyString(input.cancelReason) || reason,
    userMessage: nonEmptyString(input.userMessage) || AI_GATEWAY_HARD_CANCEL_USER_MESSAGE,
    adminMessage: nonEmptyString(input.adminMessage) || AI_GATEWAY_HARD_CANCEL_ADMIN_MESSAGE,
    upstreamTaskId: nonEmptyString(input.upstreamTaskId) || null,
    provider: nonEmptyString(input.provider) || null,
    adapterId: nonEmptyString(input.adapterId) || null,
    httpStatus: Number.isFinite(Number(input.httpStatus)) ? Number(input.httpStatus) : null,
  };
}

/** Normalize any cancel payload for Admin/public surfaces. */
export function publicAiGatewayCancelSummary(workerCancel) {
  if (!workerCancel || typeof workerCancel !== 'object') return null;
  const mode = nonEmptyString(workerCancel.mode) || 'soft';
  return {
    mode,
    cancelled: workerCancel.cancelled === true,
    reason: nonEmptyString(workerCancel.reason) || null,
    cancelReason: nonEmptyString(workerCancel.cancelReason) || nonEmptyString(workerCancel.reason) || null,
    userMessage:
      nonEmptyString(workerCancel.userMessage) ||
      (mode === 'hard' ? AI_GATEWAY_HARD_CANCEL_USER_MESSAGE : AI_GATEWAY_SOFT_CANCEL_USER_MESSAGE),
    adminMessage:
      nonEmptyString(workerCancel.adminMessage) ||
      (mode === 'hard' ? AI_GATEWAY_HARD_CANCEL_ADMIN_MESSAGE : AI_GATEWAY_SOFT_CANCEL_ADMIN_MESSAGE),
    upstreamTaskId: nonEmptyString(workerCancel.upstreamTaskId) || null,
    provider: nonEmptyString(workerCancel.provider) || null,
  };
}
