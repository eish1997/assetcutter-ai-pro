import { describe, expect, it } from 'vitest';
import { ensureWorkflowAssetVgp } from '../services/vgp/migrateLegacyAsset';
import { createInitialVgpForAsset } from '../services/vgp/vgpStore';
import type { WorkflowAsset } from '../types';

const minimal = (over: Partial<WorkflowAsset>): WorkflowAsset =>
  ({
    id: 'a1',
    original: 'data:image/png;base64,xx',
    displayKey: 'original',
    results: {},
    resultOrder: [],
    archived: false,
    hiddenInGrid: false,
    createdAt: 1,
    ...over,
  }) as WorkflowAsset;

describe('ensureWorkflowAssetVgp', () => {
  it('rebuilds when vgp is only original but resultOrder has steps (stale/cloud sync)', () => {
    const vgp = createInitialVgpForAsset({ id: 'a1', createdAt: 1 });
    expect(vgp.versionOrder.length).toBe(1);
    const asset = minimal({
      resultOrder: ['step1', 'step2'],
      results: { step1: 'data:image/png;base64,a', step2: 'data:image/png;base64,b' },
      vgp,
    });
    const out = ensureWorkflowAssetVgp(asset);
    expect(out.vgp?.versionOrder.length).toBe(3);
  });

  it('returns same reference when vgp already covers resultOrder', () => {
    const asset = ensureWorkflowAssetVgp(
      minimal({
        resultOrder: ['s1'],
        results: { s1: 'data:image/png;base64,x' },
      })
    );
    const vgp = asset.vgp;
    const again = ensureWorkflowAssetVgp(asset);
    expect(again).toBe(asset);
    expect(again.vgp).toBe(vgp);
  });
});
