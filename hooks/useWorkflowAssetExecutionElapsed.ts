import { useEffect, useMemo, useRef, useState } from 'react';
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
 * 工作流队列：按资产跟踪「当前正在执行」任务的已运行秒数（每秒刷新）。
 * 同一资产新任务进入 active 时重新计时。
 */
export function useWorkflowAssetExecutionElapsed(
  executingQueue: { tasks: WorkflowPendingTask[] } | null,
  activeTaskIds: ReadonlySet<string>
): ReadonlyMap<string, number> {
  const entriesRef = useRef<Map<string, ActiveEntry>>(new Map());
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (activeTaskIds.size === 0) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [activeTaskIds.size]);

  return useMemo(() => {
    const now = Date.now();
    syncActiveEntries(entriesRef.current, executingQueue, activeTaskIds, now);
    const out = new Map<string, number>();
    entriesRef.current.forEach((entry, assetId) => {
      out.set(assetId, Math.max(0, Math.floor((now - entry.startedAt) / 1000)));
    });
    return out;
  }, [tick, executingQueue, activeTaskIds]);
}

export function formatWorkflowExecutionElapsedLabel(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${s} 秒`;
}
