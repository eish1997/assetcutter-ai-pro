import { describe, expect, it } from 'vitest';
import type { WorkflowAsset, WorkflowPendingTask } from '../types';
import type { WorkflowProjectBundle } from '../services/workspaceProjectStore';
import { mergeWorkflowProjectBundles } from '../services/workflowBundleMerge';
import { createStoryboardTableRow } from '../services/storyboardTableAsset';

const baseAsset = (id: string, overrides: Partial<WorkflowAsset> = {}): WorkflowAsset => ({
  id,
  original: '',
  displayKey: 'original',
  results: {},
  resultOrder: [],
  archived: false,
  hiddenInGrid: false,
  createdAt: 1,
  ...overrides,
});

const pending = (p: Partial<WorkflowPendingTask> & Pick<WorkflowPendingTask, 'id' | 'assetId' | 'actionType'>): WorkflowPendingTask => ({
  inputImage: '',
  addedAt: 1,
  ...p,
});

describe('mergeWorkflowProjectBundles', () => {
  it('fills step keys present only on other', () => {
    const base: WorkflowProjectBundle = {
      assets: [baseAsset('a1', { results: { x: 'base-x' }, resultOrder: ['x'] })],
      pending: [],
    };
    const other: WorkflowProjectBundle = {
      assets: [baseAsset('a1', { results: { x: 'base-x', y: 'only-other' }, resultOrder: ['x', 'y'] })],
      pending: [],
    };
    const { merged, conflicts } = mergeWorkflowProjectBundles(base, other, { sameKey: { kind: 'prefer-base' } });
    expect(conflicts).toEqual([]);
    expect(merged.assets[0].results?.y).toBe('only-other');
    expect(merged.assets[0].results?.x).toBe('base-x');
  });

  it('appends assets that exist only on other', () => {
    const base: WorkflowProjectBundle = { assets: [baseAsset('a1')], pending: [] };
    const other: WorkflowProjectBundle = { assets: [baseAsset('a2', { original: 'z' })], pending: [] };
    const { merged } = mergeWorkflowProjectBundles(base, other, { sameKey: { kind: 'prefer-base' } });
    expect(merged.assets.map((x) => x.id)).toEqual(['a1', 'a2']);
    expect(merged.assets[1].original).toBe('z');
  });

  it('timestamp-wins picks newer executedAt on conflicting step', () => {
    const base: WorkflowProjectBundle = {
      assets: [
        baseAsset('a1', {
          results: { step1: 'A' },
          resultOrder: ['step1'],
          resultMeta: { step1: { executedAt: 100 } },
        }),
      ],
      pending: [],
    };
    const other: WorkflowProjectBundle = {
      assets: [
        baseAsset('a1', {
          results: { step1: 'B' },
          resultOrder: ['step1'],
          resultMeta: { step1: { executedAt: 200 } },
        }),
      ],
      pending: [],
    };
    const { merged } = mergeWorkflowProjectBundles(base, other, { sameKey: { kind: 'timestamp-wins' } });
    expect(merged.assets[0].results?.step1).toBe('B');
  });

  it('timestamp-wins keeps base when other is older', () => {
    const base: WorkflowProjectBundle = {
      assets: [
        baseAsset('a1', {
          results: { step1: 'A' },
          resultMeta: { step1: { executedAt: 300 } },
        }),
      ],
      pending: [],
    };
    const other: WorkflowProjectBundle = {
      assets: [
        baseAsset('a1', {
          results: { step1: 'B' },
          resultMeta: { step1: { executedAt: 200 } },
        }),
      ],
      pending: [],
    };
    const { merged } = mergeWorkflowProjectBundles(base, other, { sameKey: { kind: 'timestamp-wins' } });
    expect(merged.assets[0].results?.step1).toBe('A');
  });

  it('keep-both duplicates conflicting step under new id', () => {
    const base: WorkflowProjectBundle = {
      assets: [baseAsset('a1', { results: { s: 'one' }, resultOrder: ['s'] })],
      pending: [],
    };
    const other: WorkflowProjectBundle = {
      assets: [baseAsset('a1', { results: { s: 'two' }, resultOrder: ['s'] })],
      pending: [],
    };
    const { merged, conflicts } = mergeWorkflowProjectBundles(base, other, {
      sameKey: { kind: 'keep-both', duplicateStepSuffix: '__dup' },
    });
    expect(conflicts).toEqual([]);
    expect(merged.assets[0].results?.s).toBe('one');
    expect(merged.assets[0].results?.s__dup).toBe('two');
  });

  it('defer-dialog records result conflict without overwriting base', () => {
    const base: WorkflowProjectBundle = {
      assets: [baseAsset('a1', { results: { s: 'keep-me' }, resultMeta: { s: { executedAt: 500 } } })],
      pending: [],
    };
    const other: WorkflowProjectBundle = {
      assets: [baseAsset('a1', { results: { s: 'other' }, resultMeta: { s: { executedAt: 400 } } })],
      pending: [],
    };
    const { merged, conflicts } = mergeWorkflowProjectBundles(base, other, { sameKey: { kind: 'defer-dialog' } });
    expect(merged.assets[0].results?.s).toBe('keep-me');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      kind: 'result-step',
      assetId: 'a1',
      stepId: 's',
      baseExecutedAt: 500,
      otherExecutedAt: 400,
    });
  });

  it('merges pending tasks by id: append when only on other', () => {
    const base: WorkflowProjectBundle = {
      assets: [baseAsset('a1')],
      pending: [pending({ id: 'p1', assetId: 'a1', actionType: 'x', addedAt: 1 })],
    };
    const other: WorkflowProjectBundle = {
      assets: [baseAsset('a1')],
      pending: [
        pending({ id: 'p1', assetId: 'a1', actionType: 'x', addedAt: 1 }),
        pending({ id: 'p2', assetId: 'a1', actionType: 'y', addedAt: 2 }),
      ],
    };
    const { merged } = mergeWorkflowProjectBundles(base, other, { sameKey: { kind: 'prefer-base' } });
    expect(merged.pending.map((t) => t.id)).toEqual(['p1', 'p2']);
  });

  it('pending same id: timestamp-wins replaces row', () => {
    const base: WorkflowProjectBundle = {
      assets: [baseAsset('a1')],
      pending: [pending({ id: 'p1', assetId: 'a1', actionType: 'x', inputImage: 'old', addedAt: 10 })],
    };
    const other: WorkflowProjectBundle = {
      assets: [baseAsset('a1')],
      pending: [pending({ id: 'p1', assetId: 'a1', actionType: 'x', inputImage: 'new', addedAt: 99 })],
    };
    const { merged } = mergeWorkflowProjectBundles(base, other, { sameKey: { kind: 'timestamp-wins' } });
    expect(merged.pending).toHaveLength(1);
    expect(merged.pending[0].inputImage).toBe('new');
  });

  it('pending asset-action: same asset+action different task id picks newer addedAt', () => {
    const base: WorkflowProjectBundle = {
      assets: [baseAsset('a1')],
      pending: [pending({ id: 'p-local', assetId: 'a1', actionType: 'cap1', inputImage: 'old', addedAt: 10 })],
    };
    const other: WorkflowProjectBundle = {
      assets: [baseAsset('a1')],
      pending: [pending({ id: 'p-remote', assetId: 'a1', actionType: 'cap1', inputImage: 'new', addedAt: 50 })],
    };
    const { merged } = mergeWorkflowProjectBundles(base, other, {
      sameKey: { kind: 'timestamp-wins' },
      pendingKeyedBy: 'asset-action',
    });
    expect(merged.pending).toHaveLength(1);
    expect(merged.pending[0].inputImage).toBe('new');
  });

  it('pending same id: keep-both clones second task with new id', () => {
    const base: WorkflowProjectBundle = {
      assets: [baseAsset('a1')],
      pending: [pending({ id: 'p1', assetId: 'a1', actionType: 'x', inputImage: 'old', addedAt: 10 })],
    };
    const other: WorkflowProjectBundle = {
      assets: [baseAsset('a1')],
      pending: [pending({ id: 'p1', assetId: 'a1', actionType: 'x', inputImage: 'new', addedAt: 20 })],
    };
    const { merged } = mergeWorkflowProjectBundles(base, other, { sameKey: { kind: 'keep-both' } });
    expect(merged.pending).toHaveLength(2);
    const imgs = merged.pending.map((t) => t.inputImage).sort();
    expect(imgs).toEqual(['new', 'old']);
    expect(new Set(merged.pending.map((t) => t.id)).size).toBe(2);
  });

  it('unions capabilityRefs by kind:id', () => {
    const base: WorkflowProjectBundle = {
      assets: [baseAsset('a1')],
      pending: [],
      capabilityRefs: [{ kind: 'preset', id: 'p1', snapshot: { a: 1 } }],
    };
    const other: WorkflowProjectBundle = {
      assets: [baseAsset('a1')],
      pending: [],
      capabilityRefs: [
        { kind: 'preset', id: 'p1', snapshot: { b: 2 } },
        { kind: 'set', id: 's1' },
      ],
    };
    const { merged } = mergeWorkflowProjectBundles(base, other, { sameKey: { kind: 'prefer-base' } });
    const keys = (merged.capabilityRefs || []).map((r) => `${r.kind}:${r.id}`).sort();
    expect(keys).toEqual(['preset:p1', 'set:s1']);
    const p1 = merged.capabilityRefs?.find((r) => r.id === 'p1');
    expect((p1?.snapshot as { a?: number })?.a).toBe(1);
  });

  it('keeps generate_3d step in resultOrder when only meta/model keys exist (no inline image)', () => {
    const base: WorkflowProjectBundle = {
      assets: [
        baseAsset('a1', {
          results: { cut: 'img-a' },
          resultOrder: ['cut', 'generate_3d'],
          resultMeta: {
            cut: { executedAt: 100 },
            generate_3d: { executedAt: 200, tripoTaskId: 'tripo-1', mediaKind: 'model3d' },
          },
          stepModelCompanionKeys: { generate_3d: ['wf-mdl-key'] },
        }),
      ],
      pending: [],
    };
    const other: WorkflowProjectBundle = {
      assets: [
        baseAsset('a1', {
          results: { cut: 'img-b' },
          resultOrder: ['cut'],
          resultMeta: { cut: { executedAt: 150 } },
        }),
      ],
      pending: [],
    };
    const { merged } = mergeWorkflowProjectBundles(base, other, { sameKey: { kind: 'timestamp-wins' } });
    expect(merged.assets[0].resultOrder).toContain('generate_3d');
    expect(merged.assets[0].resultMeta?.generate_3d?.tripoTaskId).toBe('tripo-1');
    expect(merged.assets[0].stepModelCompanionKeys?.generate_3d).toEqual(['wf-mdl-key']);
  });

  it('fills generate_3d meta-only step from other when base lacks image result', () => {
    const base: WorkflowProjectBundle = {
      assets: [baseAsset('a1', { results: { cut: 'img' }, resultOrder: ['cut'] })],
      pending: [],
    };
    const other: WorkflowProjectBundle = {
      assets: [
        baseAsset('a1', {
          results: { cut: 'img' },
          resultOrder: ['cut', 'generate_3d'],
          resultMeta: {
            generate_3d: { executedAt: 300, tripoTaskId: 'tripo-2', mediaKind: 'model3d' },
          },
          stepModelUrls: { generate_3d: ['blob:model'] },
        }),
      ],
      pending: [],
    };
    const { merged } = mergeWorkflowProjectBundles(base, other, { sameKey: { kind: 'prefer-base' } });
    expect(merged.assets[0].resultOrder).toContain('generate_3d');
    expect(merged.assets[0].resultMeta?.generate_3d?.tripoTaskId).toBe('tripo-2');
    expect(merged.assets[0].stepModelUrls?.generate_3d).toEqual(['blob:model']);
  });

  it('retains generate_3d step with tencentJobId only (no preview image)', () => {
    const base: WorkflowProjectBundle = {
      assets: [baseAsset('a1', { results: { cut: 'img' }, resultOrder: ['cut'] })],
      pending: [],
    };
    const other: WorkflowProjectBundle = {
      assets: [
        baseAsset('a1', {
          results: { cut: 'img' },
          resultOrder: ['cut', 'hunyuan_pro'],
          resultMeta: {
            hunyuan_pro: { executedAt: 400, tencentJobId: 'job-abc', mediaKind: 'model3d' },
          },
          stepModelCompanionKeys: { hunyuan_pro: ['wf-tencent-key'] },
        }),
      ],
      pending: [],
    };
    const { merged } = mergeWorkflowProjectBundles(base, other, { sameKey: { kind: 'prefer-base' } });
    expect(merged.assets[0].resultOrder).toContain('hunyuan_pro');
    expect(merged.assets[0].resultMeta?.hunyuan_pro?.tencentJobId).toBe('job-abc');
    expect(merged.assets[0].stepModelCompanionKeys?.hunyuan_pro).toEqual(['wf-tencent-key']);
  });

  it('merges storyboard table rows so remote frame refs survive local text-only rows', () => {
    const base: WorkflowProjectBundle = {
      assets: [
        baseAsset('sb1', {
          assetKind: 'storyboard_table',
          textTitle: '分镜表',
          storyboardTable: {
            fieldCatalog: [],
            rows: [
              createStoryboardTableRow(
                {
                  id: 'row-1',
                  shotNo: '131',
                  shotRaw: '本地文本',
                },
                0
              ),
            ],
          },
        }),
      ],
      pending: [],
    };
    const other: WorkflowProjectBundle = {
      assets: [
        baseAsset('sb1', {
          assetKind: 'storyboard_table',
          textTitle: '分镜表',
          storyboardTable: {
            fieldCatalog: [],
            rows: [
              createStoryboardTableRow(
                {
                  id: 'row-1',
                  shotNo: '131',
                  frameImageCompanionKey: 'remote-frame-key',
                },
                0
              ),
            ],
          },
        }),
      ],
      pending: [],
    };
    const { merged } = mergeWorkflowProjectBundles(base, other, { sameKey: { kind: 'prefer-base' } });
    const row = merged.assets[0].storyboardTable?.rows[0];
    expect(row?.shotRaw).toContain('本地文本');
    expect(row?.frameImageCompanionKey).toBe('remote-frame-key');
  });
});
