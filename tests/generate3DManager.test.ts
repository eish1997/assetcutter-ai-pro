import { describe, expect, it } from 'vitest';

import {
  applyGenerate3DQueueCancellation,
  applyGenerate3DQueueRetry,
  consumeCancelledGenerate3DQueueJob,
  clearInactiveGenerate3DQueue,
  type Generate3DQueueItem,
} from '../hooks/useGenerate3DManager';

describe('useGenerate3DManager helpers', () => {
  it('只允许取消 pending 或 running 的任务', () => {
    const queue: Generate3DQueueItem[] = [
      { id: 'a', type: 'pro', status: 'pending', label: '任务A' },
      { id: 'b', type: 'rapid', status: 'done', label: '任务B' },
    ];

    const { nextQueue, cancelledItem } = applyGenerate3DQueueCancellation(queue, 'b');

    expect(cancelledItem).toBeUndefined();
    expect(nextQueue).toEqual(queue);
  });

  it('取消任务时会写入 cancelled 状态与取消原因', () => {
    const queue: Generate3DQueueItem[] = [
      { id: 'a', type: 'pro', status: 'running', label: '任务A', progress: 32 },
      { id: 'b', type: 'rapid', status: 'pending', label: '任务B' },
    ];

    const { nextQueue, cancelledItem } = applyGenerate3DQueueCancellation(queue, 'a');

    expect(cancelledItem).toMatchObject({
      id: 'a',
      status: 'cancelled',
      error: '用户已取消',
      progress: 32,
    });
    expect(nextQueue[0]).toMatchObject({
      id: 'a',
      status: 'cancelled',
      error: '用户已取消',
    });
    expect(nextQueue[1]).toEqual(queue[1]);
  });

  it('失败或取消的任务可以重试并回到 pending', () => {
    const queue: Generate3DQueueItem[] = [
      { id: 'a', type: 'pro', status: 'fail', label: '任务A', error: '网络错误', progress: 56, result: [] },
      { id: 'b', type: 'rapid', status: 'running', label: '任务B' },
    ];

    const { nextQueue, retriedItem } = applyGenerate3DQueueRetry(queue, 'a');

    expect(retriedItem).toMatchObject({
      id: 'a',
      status: 'pending',
      progress: 0,
    });
    expect(retriedItem?.error).toBeUndefined();
    expect(retriedItem?.result).toBeUndefined();
    expect(nextQueue[0]).toMatchObject({ id: 'a', status: 'pending' });
  });

  it('清理队列时只保留 pending 和 running', () => {
    const queue: Generate3DQueueItem[] = [
      { id: 'a', type: 'pro', status: 'pending' },
      { id: 'b', type: 'rapid', status: 'running' },
      { id: 'c', type: 'uv', status: 'done' },
      { id: 'd', type: 'texture', status: 'fail' },
      { id: 'e', type: 'component', status: 'cancelled' },
    ];

    expect(clearInactiveGenerate3DQueue(queue)).toEqual([
      { id: 'a', type: 'pro', status: 'pending' },
      { id: 'b', type: 'rapid', status: 'running' },
    ]);
  });

  it('取消标记在执行前与写回前都可以被消费，避免伪取消后继续落结果', () => {
    const cancelledJobIds = new Set(['job-1']);

    expect(consumeCancelledGenerate3DQueueJob(cancelledJobIds, 'job-1')).toBe(true);
    expect(cancelledJobIds.has('job-1')).toBe(false);
    expect(consumeCancelledGenerate3DQueueJob(cancelledJobIds, 'job-1')).toBe(false);
  });
});
