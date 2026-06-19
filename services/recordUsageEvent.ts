import type { UsageEventInput } from '../shared/usageBilling';
import { apiUrl } from './apiBase';
import { requestJson } from './httpClient';
import { peekUsageRecordContext } from './usageRecordContext';

function logUsageSyncFailure(err: unknown): void {
  try {
    if (!import.meta.env.DEV) return;
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[usage-billing] 上报失败（管理端用量页将无记录）:', msg);
  } catch {
    /* ignore */
  }
}

/** 仅当调用方显式标记 meta.byok 时清空估算；勿因「设置里存了 Key」误判本站代理路径。 */
function withByokMeta(input: UsageEventInput): UsageEventInput {
  if (input.meta?.byok !== true) return input;
  return {
    ...input,
    costUsdEst: null,
    costConfidence: 'unknown',
    meta: { ...(input.meta || {}), byok: true },
  };
}

function mergeContext(input: UsageEventInput): UsageEventInput {
  const ctx = peekUsageRecordContext();
  return {
    ...input,
    projectId: input.projectId ?? ctx.projectId,
    workflowStepId: input.workflowStepId ?? ctx.workflowStepId,
    meta: {
      ...(input.meta || {}),
      ...(ctx.assetId ? { assetId: ctx.assetId } : {}),
      ...(ctx.taskId ? { taskId: ctx.taskId } : {}),
    },
  };
}

/**
 * Fire-and-forget：登录用户将用量事件写入 auth-api（幂等键去重）。
 * 未登录或 401 时静默跳过。
 */
export function recordUsageEvent(input: UsageEventInput): void {
  if (typeof fetch !== 'function') return;
  const idempotencyKey = String(input.idempotencyKey || '').trim();
  if (!idempotencyKey) return;
  const payload = withByokMeta(mergeContext(input));
  void requestJson<{ ok?: boolean; inserted?: number; disabled?: boolean }>(apiUrl('/api/usage/events'), {
    method: 'POST',
    body: JSON.stringify({ events: [payload] }),
  }).catch((e) => {
    const msg = e instanceof Error ? e.message : String(e);
    if (/401|403/.test(msg)) return;
    logUsageSyncFailure(e);
  });
}

export async function recordUsageEventAwait(input: UsageEventInput): Promise<void> {
  const idempotencyKey = String(input.idempotencyKey || '').trim();
  if (!idempotencyKey) return;
  const payload = withByokMeta(mergeContext(input));
  await requestJson(apiUrl('/api/usage/events'), {
    method: 'POST',
    body: JSON.stringify({ events: [payload] }),
  }).catch(logUsageSyncFailure);
}
