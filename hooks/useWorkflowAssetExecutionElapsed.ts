import { useMemo, useRef } from 'react';
import type { WorkflowPendingTask } from '../types';

type ActiveEntry = { taskId: string; startedAt: number };

function syncActiveEntries(
  entries: Map<string, ActiveEntry>,
  executingQueue: { tasks: WorkflowPendingTask[] } | null,
  activeTaskIds: ReadonlySet<string>,
  now: number
): void {
  if (!executingQueue) {
    entries.clear();
    return;
  }
  const stillActive = new Set<string>();
  for (const task of executingQueue.tasks) {
    if (!activeTaskIds.has(task.id)) continue;
    stillActive.add(task.assetId);
    const prev = entries.get(task.assetId);
    if (!prev || prev.taskId !== task.id) {
      entries.set(task.assetId, { taskId: task.id, startedAt: now });
    }
  }
  for (const assetId of [...entries.keys()]) {
    if (!stillActive.has(assetId)) entries.delete(assetId);
  }
}

/**
 * 工作流队列：返回各资产当前 active 任务的开始时间戳（毫秒）。
 * 不在 hook 内每秒 tick，避免 WorkflowSection 整树重绘；计时 UI 用 `useExecutionElapsedSeconds`。
 */
export function useWorkflowExecutionStartedAt(
  executingQueue: { tasks: WorkflowPendingTask[] } | null,
  activeTaskIds: ReadonlySet<string>
): ReadonlyMap<string, number> {
  const entriesRef = useRef<Map<string, ActiveEntry>>(new Map());

  return useMemo(() => {
    syncActiveEntries(entriesRef.current, executingQueue, activeTaskIds, Date.now());
    const out = new Map<string, number>();
    entriesRef.current.forEach((entry, assetId) => {
      out.set(assetId, entry.startedAt);
    });
    return out;
  }, [executingQueue, activeTaskIds]);
}

/** @deprecated 请用 `useWorkflowExecutionStartedAt` + 组件内 `useExecutionElapsedSeconds` */
export function useWorkflowAssetExecutionElapsed(
  executingQueue: { tasks: WorkflowPendingTask[] } | null,
  activeTaskIds: ReadonlySet<string>
): ReadonlyMap<string, number> {
  const startedAt = useWorkflowExecutionStartedAt(executingQueue, activeTaskIds);
  return useMemo(() => {
    const now = Date.now();
    const out = new Map<string, number>();
    startedAt.forEach((ts, assetId) => {
      out.set(assetId, Math.max(0, Math.floor((now - ts) / 1000)));
    });
    return out;
  }, [startedAt]);
}

export function formatWorkflowExecutionElapsedLabel(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${s} 秒`;
}
