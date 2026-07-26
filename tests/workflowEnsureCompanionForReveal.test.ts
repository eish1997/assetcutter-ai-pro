import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowAsset } from '../types';

const mocks = vi.hoisted(() => ({
  importCompanionAssetFromUrl: vi.fn(),
  putCompanionAsset: vi.fn(),
}));

vi.mock('../services/companionClient/storage', () => ({
  fetchCompanionAssetBlob: vi.fn(),
  getCompanionManifest: vi.fn(),
  importCompanionAssetFromUrl: mocks.importCompanionAssetFromUrl,
  listCompanionProjects: vi.fn(),
  putCompanionAsset: mocks.putCompanionAsset,
}));

import {
  canAttemptOpenWorkflowAssetFolder,
  ensureWorkflowAssetCompanionKeyForReveal,
} from '../services/workflowEnsureCompanionForReveal';

const ASSET_ID = '550e8400-e29b-41d4-a716-446655440000';

function textCardWithTtiResult(overrides?: Partial<WorkflowAsset>): WorkflowAsset {
  return {
    id: ASSET_ID,
    assetKind: 'text',
    textBody: '一只柯基',
    original: '',
    displayKey: 'text_to_image',
    results: {
      text_to_image: 'https://cdn.example.com/corgi.png',
    },
    resultOrder: ['text_to_image'],
    archived: false,
    hiddenInGrid: false,
    createdAt: 1,
    ...overrides,
  };
}

describe('canAttemptOpenWorkflowAssetFolder', () => {
  it('enables when text birth shell has display raster but no companion key yet', () => {
    expect(
      canAttemptOpenWorkflowAssetFolder({
        projectId: 'proj-1',
        companionBaseUrl: 'http://127.0.0.1:18765',
        hasCompanionKey: false,
        asset: textCardWithTtiResult(),
      })
    ).toBe(true);
  });

  it('disables when companion explicitly offline', () => {
    expect(
      canAttemptOpenWorkflowAssetFolder({
        projectId: 'proj-1',
        companionBaseUrl: null,
        hasCompanionKey: false,
        asset: textCardWithTtiResult(),
      })
    ).toBe(false);
  });
});

describe('ensureWorkflowAssetCompanionKeyForReveal', () => {
  afterEach(() => {
    mocks.importCompanionAssetFromUrl.mockReset();
    mocks.putCompanionAsset.mockReset();
  });

  it('writes resultsCompanionKeys for text birth shell TTI (never originalCompanionKey)', async () => {
    mocks.importCompanionAssetFromUrl.mockResolvedValue({
      ok: true,
      data: { key: `${ASSET_ID}/image-full-0-550e8400.png` },
    });
    mocks.putCompanionAsset.mockResolvedValue({ ok: true, data: { key: 'preview' } });

    const asset = textCardWithTtiResult();
    const out = await ensureWorkflowAssetCompanionKeyForReveal({
      asset,
      projectId: 'proj-1',
      companionBaseUrl: 'http://127.0.0.1:18765',
    });

    expect(out.ok).toBe(true);
    if (out.ok !== true) return;
    expect(out.wrote).toBe(true);
    expect(out.asset.originalCompanionKey).toBeUndefined();
    expect(out.asset.resultsCompanionKeys?.text_to_image).toContain('image-full-0-550e8400');
    expect(out.companionKey).toBe(out.asset.resultsCompanionKeys?.text_to_image);
    expect(mocks.importCompanionAssetFromUrl).toHaveBeenCalled();
  });

  it('is a no-op when resultsCompanionKeys already present', async () => {
    const asset = textCardWithTtiResult({
      resultsCompanionKeys: { text_to_image: `${ASSET_ID}/image-full-0-550e8400.png` },
    });
    const out = await ensureWorkflowAssetCompanionKeyForReveal({
      asset,
      projectId: 'proj-1',
      companionBaseUrl: 'http://127.0.0.1:18765',
    });
    expect(out.ok).toBe(true);
    if (out.ok !== true) return;
    expect(out.wrote).toBe(false);
    expect(mocks.importCompanionAssetFromUrl).not.toHaveBeenCalled();
  });
});
