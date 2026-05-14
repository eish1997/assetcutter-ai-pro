import { describe, expect, it } from 'vitest';
import { compareWorkflowOverlayDraftToPersisted } from '../services/workflowOverlayDraftCompare';
import type { ImageOverlayAnnotationDoc } from '../types';

const empty = (): ImageOverlayAnnotationDoc => ({ v: 1, items: [], crops: [] });

describe('compareWorkflowOverlayDraftToPersisted', () => {
  it('returns clean when both buckets match', () => {
    const d = empty();
    expect(
      compareWorkflowOverlayDraftToPersisted({
        draftFlat: d,
        draftPano: d,
        storedFlat: d,
        storedPano: d,
      })
    ).toBe('clean');
  });

  it('returns dirty when flat differs', () => {
    const a = empty();
    const b: ImageOverlayAnnotationDoc = {
      v: 1,
      items: [
        {
          id: '1',
          kind: 'brush',
          points: [{ x: 0, y: 0 }],
          stroke: '#fff',
          sw: 2,
        },
      ],
      crops: [],
    };
    expect(
      compareWorkflowOverlayDraftToPersisted({
        draftFlat: b,
        draftPano: a,
        storedFlat: a,
        storedPano: a,
      })
    ).toBe('dirty');
  });
});
