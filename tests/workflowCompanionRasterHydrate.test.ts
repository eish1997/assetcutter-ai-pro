import { describe, expect, it } from 'vitest';
import {
  companionRasterSlotNeedsHydrate,
  prepareWorkflowBundleAfterLoad,
  workflowAssetNeedsCompanionOriginalHydrate,
  workflowAssetNeedsCompanionResultHydrate,
  workflowBundleNeedsCompanionHydrateForCloudPack,
} from '../services/workflowCompanionAssets';
import type { WorkflowAsset, WorkflowPendingTask } from '../types';

describe('workflowCompanionRasterHydrate', () => {
  it('companionRasterSlotNeedsHydrate treats stale blob as needing fetch', () => {
    expect(companionRasterSlotNeedsHydrate('', 'ck-1')).toBe(true);
    expect(companionRasterSlotNeedsHydrate('blob:http://localhost/x', 'ck-1')).toBe(false);
    expect(companionRasterSlotNeedsHydrate('data:image/png;base64,abc', 'ck-1')).toBe(false);
    expect(companionRasterSlotNeedsHydrate('', '')).toBe(false);
  });

  it('workflowAssetNeedsCompanionOriginalHydrate after page reload with empty original', () => {
    const a = {
      id: 'a1',
      original: '',
      originalCompanionKey: 'wf-orig-a1',
    } as WorkflowAsset;
    expect(workflowAssetNeedsCompanionOriginalHydrate(a)).toBe(true);
    const hydrated = { ...a, original: 'blob:http://localhost/abc' } as WorkflowAsset;
    expect(workflowAssetNeedsCompanionOriginalHydrate(hydrated)).toBe(false);
  });

  it('workflowAssetNeedsCompanionResultHydrate when step result is empty', () => {
    const a = {
      id: 'a1',
      results: { step1: '' },
      resultsCompanionKeys: { step1: 'wf-res-a1-step1' },
    } as WorkflowAsset;
    expect(workflowAssetNeedsCompanionResultHydrate(a)).toBe(true);
  });

  it('companionRasterSlotNeedsHydrate treats expired https with companion key as needing hydrate', () => {
    expect(companionRasterSlotNeedsHydrate('https://cdn.example.com/out.png', 'wf-res-a1-step1')).toBe(true);
  });

  it('prepareWorkflowBundleAfterLoad strips https results when companion key exists', () => {
    const asset: WorkflowAsset = {
      id: 'a1',
      original: '',
      displayKey: 'original',
      results: { step1: 'https://cdn.example.com/out.png' },
      resultsCompanionKeys: { step1: 'wf-res-a1-step1' },
    };
    const out = prepareWorkflowBundleAfterLoad({ assets: [asset], pending: [] });
    expect(out.assets[0]?.results?.step1).toBe('');
  });

  it('prepareWorkflowBundleAfterLoad strips pending blob URLs', () => {
    const pending: WorkflowPendingTask[] = [
      {
        id: 't1',
        actionType: 'x',
        inputImage: 'blob:http://localhost/abc',
        status: 'PENDING',
      } as WorkflowPendingTask,
    ];
    const out = prepareWorkflowBundleAfterLoad({ assets: [], pending });
    expect(out.pending[0]?.inputImage).toBe('');
  });

  it('workflowBundleNeedsCompanionHydrateForCloudPack detects storyboard-only companion refs', () => {
    const asset: WorkflowAsset = {
      id: 'sb1',
      assetKind: 'storyboard_table',
      displayKey: 'original',
      original: '',
      storyboardTable: {
        fieldCatalog: [],
        rows: [
          {
            id: 'r1',
            index: 0,
            shotFields: {},
            shotText: '',
            frameImageCompanionKey: 'wf-res-sb1-storyboard-frame-r1',
          },
        ],
      },
    };
    expect(workflowBundleNeedsCompanionHydrateForCloudPack({ assets: [asset] })).toBe(true);
  });
});
