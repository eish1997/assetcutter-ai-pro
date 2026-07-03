import { describe, expect, it } from 'vitest';
import type { WorkflowAsset } from '../types';
import {
  pickWorkflowProjectPreviews,
  resolveWorkflowAssetPreviewCompanionKey,
  resolveWorkflowAssetPreviewSrc,
  WORKSPACE_PROJECT_PREVIEW_LIMIT,
} from '../services/workspaceProjectPreviews';
import { createAssetSetAsset } from '../services/assetSet/assetSetAsset';

function imageAsset(id: string, original: string): WorkflowAsset {
  return {
    id,
    original,
    displayKey: 'original',
    results: {},
  };
}

describe('workspaceProjectPreviews', () => {
  it('picks up to 8 root image previews', () => {
    const assets = Array.from({ length: 10 }, (_, i) =>
      imageAsset(`a${i}`, `data:image/png;base64,${i}`)
    );
    const { items, totalEligible, rootAssetCount } = pickWorkflowProjectPreviews({ assets, pending: [] }, 8);
    expect(items).toHaveLength(8);
    expect(totalEligible).toBe(10);
    expect(rootAssetCount).toBe(10);
    expect(items[0]?.assetId).toBe('a0');
    expect(items[7]?.assetId).toBe('a7');
  });

  it('skips text-only assets and group children', () => {
    const assets: WorkflowAsset[] = [
      {
        id: 'text-1',
        assetKind: 'text',
        original: '',
        displayKey: 'original',
        results: {},
        textBody: 'hello',
      },
      {
        id: 'child-1',
        original: 'data:image/png;base64,child',
        displayKey: 'original',
        results: {},
        groupId: 'g1',
        groupOrder: 0,
      },
      imageAsset('root-1', 'data:image/png;base64,root'),
    ];
    const { items, totalEligible, rootAssetCount } = pickWorkflowProjectPreviews({ assets, pending: [] });
    expect(totalEligible).toBe(1);
    expect(rootAssetCount).toBe(2);
    expect(items).toEqual([{ assetId: 'root-1', src: 'data:image/png;base64,root' }]);
  });

  it('counts companion-only assets as eligible but omits them from sync pick', () => {
    const assets: WorkflowAsset[] = [
      {
        id: 'a1',
        original: '',
        originalCompanionKey: 'wf-orig-1',
        displayKey: 'original',
        results: {},
      },
      {
        id: 'a2',
        original: '',
        originalCompanionKey: 'wf-orig-2',
        displayKey: 'original',
        results: {},
      },
    ];
    const { items, totalEligible, rootAssetCount } = pickWorkflowProjectPreviews({ assets, pending: [] });
    expect(totalEligible).toBe(2);
    expect(rootAssetCount).toBe(2);
    expect(items).toHaveLength(0);
    expect(resolveWorkflowAssetPreviewCompanionKey(assets[0]!, assets)).toBe('wf-orig-1');
  });

  it('resolves cloud object key when inline image is stripped', () => {
    const asset: WorkflowAsset = {
      id: 'cloud-1',
      original: '',
      originalObjectKey: 'objects/wf/preview.jpg',
      displayKey: 'original',
      results: {},
    };
    const src = resolveWorkflowAssetPreviewSrc(asset, [asset]);
    expect(src).toContain('/api/r2/objects/objects/wf/preview.jpg');
  });

  it('resolves group cover from first member with image', () => {
    const assets: WorkflowAsset[] = [
      {
        id: 'g1',
        isGroup: true,
        assetIds: ['m1', 'm2'],
        original: '',
        displayKey: 'original',
        results: {},
      },
      imageAsset('m1', 'data:image/png;base64,m1'),
      imageAsset('m2', 'data:image/png;base64,m2'),
    ];
    expect(resolveWorkflowAssetPreviewSrc(assets[0]!, assets)).toBe('data:image/png;base64,m1');
  });

  it('resolves asset set preview from component crop', () => {
    const asset = createAssetSetAsset('set-1', { title: '角色集' });
    asset.assetSet!.components = [
      {
        id: 'c1',
        index: 0,
        name: '组件 01',
        cropSource: 'styled',
        cropRegion: { id: 'b1', label: '1', xmin: 0, ymin: 0, xmax: 1, ymax: 1 },
        cropPreview: 'data:image/png;base64,crop',
        views: [],
        locked: false,
      },
    ];
    expect(resolveWorkflowAssetPreviewSrc(asset, [asset])).toBe('data:image/png;base64,crop');
  });

  it('counts root assets excluding archived, repository, and group children', () => {
    const assets: WorkflowAsset[] = [
      imageAsset('root-1', 'data:image/png;base64,1'),
      { ...imageAsset('archived', 'data:image/png;base64,a'), archived: true },
      { ...imageAsset('repo', 'data:image/png;base64,r'), inRepository: true },
      {
        id: 'child',
        original: 'data:image/png;base64,c',
        displayKey: 'original',
        results: {},
        groupId: 'g1',
        groupOrder: 0,
      },
    ];
    const { rootAssetCount } = pickWorkflowProjectPreviews({ assets, pending: [] });
    expect(rootAssetCount).toBe(1);
  });

  it('exports preview limit constant', () => {
    expect(WORKSPACE_PROJECT_PREVIEW_LIMIT).toBe(8);
  });
});
