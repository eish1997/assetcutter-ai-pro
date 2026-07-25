/**
 * AI Gateway Jobs：按 gatewayFailure.stage / owner 筛选（含 __missing__）。
 * 前后端共用，避免 Admin 仅滤当前页、服务端分页不一致。
 */

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

/** @returns {{ status: string, failure: { stage?: string, owner?: string } | null }} */
export function resolveGatewayFailureFromPlanOrSummary(item) {
  if (item && typeof item === 'object' && item.job && typeof item.job === 'object') {
    const job = item.job;
    const meta = job.metadata && typeof job.metadata === 'object' ? job.metadata : {};
    const failure =
      meta.gatewayFailure && typeof meta.gatewayFailure === 'object' ? meta.gatewayFailure : null;
    return { status: String(job.status || ''), failure };
  }
  const failure =
    item?.gatewayFailure && typeof item.gatewayFailure === 'object' ? item.gatewayFailure : null;
  return { status: String(item?.status || ''), failure };
}

/**
 * @param {unknown} item plan 或 AiJobSummary
 * @param {{ failureStage?: string, failureOwner?: string }} filters
 */
export function matchesGatewayFailureFilters(item, filters = {}) {
  const stage = nonEmptyString(filters.failureStage);
  const owner = nonEmptyString(filters.failureOwner);
  if (!stage && !owner) return true;
  const { status, failure } = resolveGatewayFailureFromPlanOrSummary(item);
  if (stage === '__missing__') {
    if (!(status === 'failed' && !failure?.stage)) return false;
  } else if (stage && failure?.stage !== stage) {
    return false;
  }
  if (owner === '__missing__') {
    if (!(status === 'failed' && !failure?.owner)) return false;
  } else if (owner && failure?.owner !== owner) {
    return false;
  }
  return true;
}
