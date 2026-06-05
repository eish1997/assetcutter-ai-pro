import { apiUrl } from './apiBase';
import { requestJson } from './httpClient';
import type { WorkflowAuditEvent } from './workflowAuditEvents';

const SYNC_CODE_PREFIX = 'RUN_TASK_';
const MAX_SYNC_BATCH = 20;

function isSyncableTaskEvent(ev: WorkflowAuditEvent): boolean {
  return ev.code.startsWith(SYNC_CODE_PREFIX);
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

/**
 * Fire-and-forget：将工作流任务执行审计上报 auth-api（服务端 id 去重）。
 */
export function syncWorkflowTaskEventToServer(ev: WorkflowAuditEvent): void {
  if (!isSyncableTaskEvent(ev)) return;
  if (typeof fetch !== 'function') return;
  const url = apiUrl('/api/workflow/task-events');
  void fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ events: [toPayload(ev)] }),
  }).catch(() => {});
}

export async function syncWorkflowTaskEventsBatch(events: WorkflowAuditEvent[]): Promise<void> {
  const batch = events.filter(isSyncableTaskEvent).slice(0, MAX_SYNC_BATCH);
  if (!batch.length) return;
  await requestJson(apiUrl('/api/workflow/task-events'), {
    method: 'POST',
    body: JSON.stringify({ events: batch.map(toPayload) }),
  });
}
