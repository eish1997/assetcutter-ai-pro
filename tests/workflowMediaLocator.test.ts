import { describe, expect, it } from 'vitest';
import {
  canOpenWorkflowAssetFolder,
  resolveWorkflowAssetLocalHandle,
} from '../services/workflowMediaLocator';
import { workflowModelCompanionStorageKey } from '../services/workflowCompanionAssets';
import type { WorkflowAsset } from '../types';

const ASSET_ID = '550e8400-e29b-41d4-a716-446655440000';

describe('resolveWorkflowAssetLocalHandle', () => {
  it('enables open-folder via asset-dir fallback when current displayKey has no companion key', () => {
    const modelKey = workflowModelCompanionStorageKey(ASSET_ID, 0, 'glb');
    const asset = {
      id: ASSET_ID,
      original: '',
      displayKey: 'step-b',
      results: {
        'step-b': 'https://cdn.example.com/preview.jpg',
      },
      resultsObjectKeys: { 'step-b': 'users/x/workspace/projects/p/assets/a/results/step-b.jpg' },
      resultOrder: ['step-b'],
      originalCompanionKey: `${ASSET_ID}/original-image-${ASSET_ID}.jpg`,
      modelCompanionKeys: [modelKey],
      archived: false,
      hiddenInGrid: false,
      createdAt: 1,
    } satisfies WorkflowAsset;

    const handle = resolveWorkflowAssetLocalHandle({
      asset,
      projectId: 'proj-1',
      companionBaseUrl: 'http://127.0.0.1:18765',
    });

    expect(canOpenWorkflowAssetFolder(handle)).toBe(true);
    expect(handle.availability).toBe('asset_dir_fallback');
    expect(handle.companionKey).toBeTruthy();
    expect(handle.reasonZh).toContain('本机目录');
  });

  it('uses exact variant companion key when present', () => {
    const asset = {
      id: ASSET_ID,
      original: '',
      displayKey: 'generate_3d',
      results: {},
      resultOrder: ['generate_3d'],
      stepModelCompanionKeys: {
        generate_3d: [workflowModelCompanionStorageKey(ASSET_ID, 0, 'glb')],
      },
      archived: false,
      hiddenInGrid: false,
      createdAt: 1,
    } satisfies WorkflowAsset;

    const handle = resolveWorkflowAssetLocalHandle({
      asset,
      projectId: 'proj-1',
      companionBaseUrl: 'http://127.0.0.1:18765',
    });

    expect(handle.availability).toBe('keyed');
    expect(handle.isExactVariant).toBe(true);
    expect(canOpenWorkflowAssetFolder(handle)).toBe(true);
  });

  it('disables when companion offline', () => {
    const asset = {
      id: ASSET_ID,
      original: '',
      displayKey: 'original',
      results: {},
      resultOrder: [],
      originalCompanionKey: `${ASSET_ID}/original-image-${ASSET_ID}.jpg`,
      archived: false,
      hiddenInGrid: false,
      createdAt: 1,
    } satisfies WorkflowAsset;

    const handle = resolveWorkflowAssetLocalHandle({
      asset,
      projectId: 'proj-1',
      companionBaseUrl: null,
    });

    expect(canOpenWorkflowAssetFolder(handle)).toBe(false);
    expect(handle.reasonZh).toContain('伴侣未连接');
  });

  it('disables when asset has no local locators', () => {
    const asset = {
      id: ASSET_ID,
      original: 'data:image/png;base64,AAA',
      displayKey: 'original',
      results: {},
      resultOrder: [],
      archived: false,
      hiddenInGrid: false,
      createdAt: 1,
    } satisfies WorkflowAsset;

    const handle = resolveWorkflowAssetLocalHandle({
      asset,
      projectId: 'proj-1',
      companionBaseUrl: 'http://127.0.0.1:18765',
    });

    expect(canOpenWorkflowAssetFolder(handle)).toBe(false);
    expect(handle.reasonZh).toContain('尚未落到本地');
  });

  it('enables via resultsCompanionKeys on text birth shell (same-card TTI)', () => {
    const asset = {
      id: ASSET_ID,
      assetKind: 'text' as const,
      textBody: '狗',
      original: '',
      displayKey: 'text_to_image',
      results: { text_to_image: 'https://cdn.example.com/dog.png' },
      resultsCompanionKeys: { text_to_image: `${ASSET_ID}/image-full-0-550e8400.png` },
      resultsPreviewCompanionKeys: { text_to_image: `${ASSET_ID}/image-thumb-0-550e8400.jpg` },
      resultOrder: ['text_to_image'],
      archived: false,
      hiddenInGrid: false,
      createdAt: 1,
    } satisfies WorkflowAsset;

    const handle = resolveWorkflowAssetLocalHandle({
      asset,
      projectId: 'proj-1',
      companionBaseUrl: 'http://127.0.0.1:18765',
    });

    expect(canOpenWorkflowAssetFolder(handle)).toBe(true);
    expect(handle.isExactVariant).toBe(true);
    expect(handle.companionKey).toContain('image-full-0-550e8400');
  });
});
