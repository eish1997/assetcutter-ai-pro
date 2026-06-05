import { isSyncableTaskEventCode } from '../shared/taskEventSyncPrefixes.js';
import { apiUrl } from './apiBase';
import { requestJson } from './httpClient';
import type { WorkflowAuditEvent } from './workflowAuditEvents';

const MAX_SYNC_BATCH = 20;

function isSyncableTaskEvent(ev: WorkflowAuditEvent): boolean {
  return isSyncableTaskEventCode(ev.code);
}

function toPayload(ev: WorkflowAuditEvent) {
  return {
    id: ev.id,
    ts: ev.ts,
    level: ev.level,
    code: ev.code,
    message: ev.message,
    assetId: ev.assetId,
    taskId: ev.taskId,
    displayKey: ev.displayKey,
    detail: ev.detail,
  };
}

function logSyncFailure(err: unknown): void {
  try {
    if (!import.meta.env.DEV) return;
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[task-events-sync] 上报失败（管理端任务执行页将无记录）:', msg);
  } catch {
    /* ignore */
  }
}

/**
 * Fire-and-forget：将工作流任务执行审计上报 auth-api（服务端 id 去重）。
 * 跨域 SPA 依赖 auth-api 对 `/api/workflow/task-events` 的 CSRF 豁免 + 会话 Cookie。
 */
export function syncWorkflowTaskEventToServer(ev: WorkflowAuditEvent): void {
  if (!isSyncableTaskEvent(ev)) return;
  if (typeof fetch !== 'function') return;
  void requestJson<{ ok?: boolean; inserted?: number }>(apiUrl('/api/workflow/task-events'), {
    method: 'POST',
    body: JSON.stringify({ events: [toPayload(ev)] }),
  }).catch(logSyncFailure);
}

export async function syncWorkflowTaskEventsBatch(events: WorkflowAuditEvent[]): Promise<void> {
  const batch = events.filter(isSyncableTaskEvent).slice(0, MAX_SYNC_BATCH);
  if (!batch.length) return;
  await requestJson(apiUrl('/api/workflow/task-events'), {
    method: 'POST',
    body: JSON.stringify({ events: batch.map(toPayload) }),
  }).catch(logSyncFailure);
}
