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

  it('fans multiple model3d steps from original instead of chaining them', () => {
    const asset = minimal({
      resultOrder: ['generate_3d', 'generate_3d__v__m2'],
      results: { generate_3d: '', 'generate_3d__v__m2': '' },
      resultMeta: {
        generate_3d: { executedAt: 1, mediaKind: 'model3d' },
        'generate_3d__v__m2': { executedAt: 2, mediaKind: 'model3d' },
      },
      stepModelCompanionKeys: {
        generate_3d: ['k1'],
        'generate_3d__v__m2': ['k2'],
      },
    });
    const out = ensureWorkflowAssetVgp(asset);
    const vgp = out.vgp!;
    const origId = vgp.originalVersionId!;
    const parents = vgp.versionOrder
      .map((id) => vgp.versionsById[id])
      .filter((v) => v && v.role !== 'original')
      .map((v) => v!.parentVersionId);
    expect(parents).toEqual([origId, origId]);
  });

  it('repairs wrongly chained model3d parents when overlay ensure runs', () => {
    const broken = ensureWorkflowAssetVgp(
      minimal({
        resultOrder: ['generate_3d', 'generate_3d__v__m2'],
        results: { generate_3d: '', 'generate_3d__v__m2': '' },
        resultMeta: {
          generate_3d: { executedAt: 1, mediaKind: 'model3d' },
          'generate_3d__v__m2': { executedAt: 2, mediaKind: 'model3d' },
        },
        stepModelCompanionKeys: {
          generate_3d: ['k1'],
          'generate_3d__v__m2': ['k2'],
        },
      })
    );
    // Force a linear chain like the old migrator.
    const vgp = broken.vgp!;
    const ids = vgp.versionOrder.filter((id) => id !== vgp.originalVersionId);
    const first = vgp.versionsById[ids[0]!];
    const second = vgp.versionsById[ids[1]!];
    expect(first && second).toBeTruthy();
    const chained: WorkflowAsset = {
      ...broken,
      vgp: {
        ...vgp,
        versionsById: {
          ...vgp.versionsById,
          [ids[0]!]: { ...first!, parentVersionId: vgp.originalVersionId! },
          [ids[1]!]: { ...second!, parentVersionId: ids[0]! },
        },
      },
    };
    const repaired = ensureWorkflowAssetVgp(chained);
    expect(repaired).not.toBe(chained);
    const rv = repaired.vgp!;
    const origId = rv.originalVersionId!;
    const parents = rv.versionOrder
      .map((id) => rv.versionsById[id])
      .filter((v) => v && v.role !== 'original')
      .map((v) => v!.parentVersionId);
    expect(parents).toEqual([origId, origId]);
  });
});
