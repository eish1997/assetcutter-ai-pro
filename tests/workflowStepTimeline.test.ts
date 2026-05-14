import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORKFLOW_STEP_TIMELINE_ORDER,
  deriveWorkflowStepTimelineRows,
} from '../services/workflowStepTimeline';
import type { WorkflowAsset } from '../types';

const baseAsset = (): WorkflowAsset =>
  ({
    id: 'a1',
    original: 'orig.png',
    displayKey: 'k2',
    results: { k1: 'a.png', k2: 'b.png' },
    resultOrder: ['original', 'k1', 'k2'],
    resultMeta: {
      k1: { executedAt: 100, displayStepLabel: 'Step One' },
      k2: { executedAt: 300 },
    },
    archived: false,
    hiddenInGrid: false,
    createdAt: 1,
  }) as unknown as WorkflowAsset;

describe('deriveWorkflowStepTimelineRows', () => {
  it('uses DEFAULT order result_order: same sequence as resultOrder', () => {
    expect(DEFAULT_WORKFLOW_STEP_TIMELINE_ORDER).toBe('result_order');
    const rows = deriveWorkflowStepTimelineRows(baseAsset(), (k) => `lbl:${k}`);
    expect(rows.map((r) => r.resultKey)).toEqual(['original', 'k1', 'k2']);
    expect(rows[1]!.label).toBe('Step One');
    expect(rows[2]!.label).toBe('lbl:k2');
  });

  it('newest_first reverses', () => {
    const rows = deriveWorkflowStepTimelineRows(baseAsset(), (k) => k, { order: 'newest_first' });
    expect(rows.map((r) => r.resultKey)).toEqual(['k2', 'k1', 'original']);
  });

  it('empty resultOrder yields empty rows', () => {
    const a = { ...baseAsset(), resultOrder: [] };
    const rows = deriveWorkflowStepTimelineRows(a, () => 'x');
    expect(rows).toEqual([]);
  });
});
