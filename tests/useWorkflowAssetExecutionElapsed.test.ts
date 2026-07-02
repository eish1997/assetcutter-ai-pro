/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useWorkflowAssetExecutionElapsed,
  useWorkflowExecutionStartedAt,
} from '../hooks/useWorkflowAssetExecutionElapsed';
import { useExecutionElapsedSeconds } from '../hooks/useExecutionElapsedSeconds';
import type { WorkflowPendingTask } from '../types';

function makeTask(id: string, assetId: string): WorkflowPendingTask {
  return {
    id,
    assetId,
    actionType: 'gen_text',
    createdAt: Date.now(),
  } as WorkflowPendingTask;
}

describe('useWorkflowExecutionStartedAt', () => {
  it('tracks startedAt for active tasks and clears when inactive', () => {
    const queue = { total: 1, tasks: [makeTask('t1', 'asset-a')] };
    const active = new Set<string>();

    const { result, rerender } = renderHook(
      ({ q, a }) => useWorkflowExecutionStartedAt(q, a),
      { initialProps: { q: queue as typeof queue | null, a: active } }
    );

    expect(result.current.has('asset-a')).toBe(false);

    rerender({ q: queue, a: new Set(['t1']) });
    expect(result.current.has('asset-a')).toBe(true);
    expect(typeof result.current.get('asset-a')).toBe('number');

    rerender({ q: queue, a: new Set() });
    expect(result.current.has('asset-a')).toBe(false);
  });
});

describe('useExecutionElapsedSeconds', () => {
  it('ticks locally without parent rerender', () => {
    vi.useFakeTimers();
    const startedAt = Date.now();
    const { result } = renderHook(() => useExecutionElapsedSeconds(startedAt, true));

    expect(result.current).toBe(0);

    act(() => {
      vi.advanceTimersByTime(3100);
    });

    expect(result.current).toBeGreaterThanOrEqual(3);
    vi.useRealTimers();
  });
});

describe('useWorkflowAssetExecutionElapsed (compat)', () => {
  it('derives elapsed from startedAt snapshot', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const queue = { total: 1, tasks: [makeTask('t1', 'asset-a')] };
    const active = new Set(['t1']);

    const { result, rerender } = renderHook(
      ({ q, a }) => useWorkflowAssetExecutionElapsed(q, a),
      { initialProps: { q: queue, a: active } }
    );

    expect(result.current.get('asset-a')).toBe(0);

    act(() => {
      vi.setSystemTime(new Date('2026-01-01T00:00:04Z'));
    });
    rerender({ q: queue, a: new Set(['t1']) });

    expect(result.current.get('asset-a')).toBe(4);

    vi.useRealTimers();
  });
});
