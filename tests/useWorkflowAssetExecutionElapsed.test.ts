/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWorkflowAssetExecutionElapsed } from '../hooks/useWorkflowAssetExecutionElapsed';
import type { WorkflowPendingTask } from '../types';

function makeTask(id: string, assetId: string): WorkflowPendingTask {
  return {
    id,
    assetId,
    actionType: 'gen_text',
    createdAt: Date.now(),
  } as WorkflowPendingTask;
}

describe('useWorkflowAssetExecutionElapsed', () => {
  it('returns elapsed seconds for actively running asset tasks', () => {
    vi.useFakeTimers();
    const queue = { total: 1, tasks: [makeTask('t1', 'asset-a')] };
    const active = new Set(['t1']);

    const { result, rerender } = renderHook(
      ({ q, a }) => useWorkflowAssetExecutionElapsed(q, a),
      { initialProps: { q: queue, a: active } }
    );

    expect(result.current.get('asset-a')).toBe(0);

    act(() => {
      vi.advanceTimersByTime(3100);
    });
    rerender({ q: queue, a: active });

    expect(result.current.get('asset-a')).toBeGreaterThanOrEqual(3);

    vi.useRealTimers();
  });

  it('clears when task leaves active set', () => {
    const queue = { total: 1, tasks: [makeTask('t1', 'asset-a')] };
    const active = new Set<string>();

    const { result, rerender } = renderHook(
      ({ q, a }) => useWorkflowAssetExecutionElapsed(q, a),
      { initialProps: { q: queue as typeof queue | null, a: active } }
    );

    expect(result.current.has('asset-a')).toBe(false);

    rerender({ q: queue, a: new Set(['t1']) });
    expect(result.current.has('asset-a')).toBe(true);

    rerender({ q: queue, a: new Set() });
    expect(result.current.has('asset-a')).toBe(false);
  });
});
