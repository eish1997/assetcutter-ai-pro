import { afterEach, describe, expect, it, vi } from 'vitest';

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

import { putWorkflowOriginalImageFromAnyUrl } from '../services/workflowCompanionAssets';

describe('putWorkflowOriginalImageFromAnyUrl', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mocks.importCompanionAssetFromUrl.mockReset();
    mocks.putCompanionAsset.mockReset();
  });

  it('https 优先走伴侣 import-url（避开浏览器 CORS）', async () => {
    mocks.importCompanionAssetFromUrl.mockResolvedValue({
      ok: true,
      data: { key: 'asset-a/image-full-0-asset-a0.png' },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('no browser fetch');
      })
    );

    const result = await putWorkflowOriginalImageFromAnyUrl(
      'http://127.0.0.1:18765',
      'project-a',
      'asset-a',
      'https://cdn.example.com/out.png'
    );

    expect(result.ok).toBe(true);
    if (result.ok !== true) return;
    expect(result.key).toBe('asset-a/image-full-0-asseta00.png');
    expect(mocks.importCompanionAssetFromUrl).toHaveBeenCalledWith(
      'http://127.0.0.1:18765',
      'project-a',
      'asset-a/image-full-0-asseta00.png',
      'https://cdn.example.com/out.png'
    );
    // sidecar 依赖再拉一次源图；fetch 失败时仍保留 import-url 主文件
    expect(mocks.putCompanionAsset).not.toHaveBeenCalled();
  });
});
