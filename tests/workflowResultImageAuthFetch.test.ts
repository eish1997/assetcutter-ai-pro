import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  importCompanionAssetFromUrl: vi.fn(),
  putCompanionAsset: vi.fn(),
  fetchMediaUrlViaAuthApi: vi.fn(),
  fetchProviderArtifactBlob: vi.fn(),
}));

vi.mock('../services/companionClient/storage', () => ({
  fetchCompanionAssetBlob: vi.fn(),
  getCompanionManifest: vi.fn(),
  importCompanionAssetFromUrl: mocks.importCompanionAssetFromUrl,
  listCompanionProjects: vi.fn(),
  putCompanionAsset: mocks.putCompanionAsset,
}));

vi.mock('../services/mediaUrlAuthFetch', () => ({
  fetchMediaUrlViaAuthApi: mocks.fetchMediaUrlViaAuthApi,
}));

vi.mock('../services/providerArtifactFetch', () => ({
  fetchProviderArtifactBlob: mocks.fetchProviderArtifactBlob,
}));

vi.mock('../services/workflowImageThumb', () => ({
  createPreviewThumbnail: vi.fn(async (src: string) => src),
}));

import { putWorkflowResultImageFromAnyUrl } from '../services/workflowCompanionAssets';

describe('putWorkflowResultImageFromAnyUrl auth-api fallback', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mocks.importCompanionAssetFromUrl.mockReset();
    mocks.putCompanionAsset.mockReset();
    mocks.fetchMediaUrlViaAuthApi.mockReset();
    mocks.fetchProviderArtifactBlob.mockReset();
  });

  it('falls back to auth-api media fetch when import-url and browser CORS both fail', async () => {
    mocks.importCompanionAssetFromUrl.mockResolvedValue({
      ok: false,
      status: 502,
      error: 'upstream_http_403',
    });
    mocks.fetchMediaUrlViaAuthApi.mockResolvedValue(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }));
    mocks.putCompanionAsset.mockResolvedValue({
      ok: true,
      data: { key: 'asset-a/result-step.png' },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      })
    );

    const result = await putWorkflowResultImageFromAnyUrl(
      'http://127.0.0.1:18765',
      'project-a',
      'asset-a',
      'text_to_image',
      'https://cdn.example.com/out.png',
      { slotIndex: 0 }
    );

    expect(result.ok).toBe(true);
    if (result.ok !== true) return;
    expect(result.key).toBe('asset-a/image-full-0-asseta00.png');
    expect(mocks.fetchMediaUrlViaAuthApi).toHaveBeenCalledWith('https://cdn.example.com/out.png');
    expect(mocks.putCompanionAsset).toHaveBeenCalled();
  });
});
