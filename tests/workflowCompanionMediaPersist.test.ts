import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  importCompanionAssetFromUrl: vi.fn(),
  putCompanionAsset: vi.fn(),
  fetchProviderArtifactBlob: vi.fn(),
}));

vi.mock('../services/companionClient/storage', () => ({
  fetchCompanionAssetBlob: vi.fn(),
  getCompanionManifest: vi.fn(),
  importCompanionAssetFromUrl: mocks.importCompanionAssetFromUrl,
  listCompanionProjects: vi.fn(),
  putCompanionAsset: mocks.putCompanionAsset,
}));

vi.mock('../services/providerArtifactFetch', () => ({
  fetchProviderArtifactBlob: mocks.fetchProviderArtifactBlob,
}));

import { putWorkflowResultMediaFromAnyUrl } from '../services/workflowCompanionAssets';
import { fetchProviderArtifactBlob } from '../services/providerArtifactFetch';

describe('putWorkflowResultMediaFromAnyUrl', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mocks.importCompanionAssetFromUrl.mockReset();
    mocks.putCompanionAsset.mockReset();
    mocks.fetchProviderArtifactBlob.mockReset();
  });

  it('falls back to browser fetch and PUT when older companion lacks import-url', async () => {
    mocks.importCompanionAssetFromUrl.mockResolvedValue({ ok: false, status: 404, error: 'not_found' });
    mocks.putCompanionAsset.mockResolvedValue({ ok: true, data: { key: 'wf-res-a1-video' } });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Blob(['mp4'], { type: 'video/mp4' }), { status: 200 }))
    );

    const result = await putWorkflowResultMediaFromAnyUrl(
      'http://127.0.0.1:18765',
      'project-a',
      'asset-a',
      'video_step',
      'https://upstream.example.com/video.mp4'
    );

    expect(result).toEqual({ ok: true, key: 'wf-res-asset-a-video_step' });
    expect(mocks.importCompanionAssetFromUrl).toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith('https://upstream.example.com/video.mp4', { credentials: 'omit' });
    expect(mocks.putCompanionAsset).toHaveBeenCalledWith(
      'http://127.0.0.1:18765',
      'project-a',
      'wf-res-asset-a-video_step',
      expect.any(Blob),
      'video/mp4'
    );
  });

  it('falls back to browser fetch and PUT when companion import-url rejects a reachable video', async () => {
    mocks.importCompanionAssetFromUrl.mockResolvedValue({ ok: false, status: 500, error: 'fetch_failed' });
    mocks.putCompanionAsset.mockResolvedValue({ ok: true, data: { key: 'wf-res-a1-video' } });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Blob(['mp4'], { type: 'video/mp4' }), { status: 200 }))
    );

    const result = await putWorkflowResultMediaFromAnyUrl(
      'http://127.0.0.1:18765',
      'project-a',
      'asset-a',
      'video_step',
      'https://upstream.example.com/signed-download?token=abc'
    );

    expect(result).toEqual({ ok: true, key: 'wf-res-asset-a-video_step' });
    expect(mocks.importCompanionAssetFromUrl).toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith('https://upstream.example.com/signed-download?token=abc', { credentials: 'omit' });
    expect(mocks.putCompanionAsset).toHaveBeenCalledWith(
      'http://127.0.0.1:18765',
      'project-a',
      'wf-res-asset-a-video_step',
      expect.any(Blob),
      'video/mp4'
    );
  });

  it('falls back to provider artifact proxy when browser cannot fetch a provider video', async () => {
    mocks.importCompanionAssetFromUrl.mockResolvedValue({ ok: false, status: 500, error: 'fetch_failed' });
    mocks.fetchProviderArtifactBlob.mockResolvedValue(new Blob(['mp4'], { type: 'video/mp4' }));
    mocks.putCompanionAsset.mockResolvedValue({ ok: true, data: { key: 'wf-res-a1-video' } });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('CORS blocked'); }));

    const result = await putWorkflowResultMediaFromAnyUrl(
      'http://127.0.0.1:18765',
      'project-a',
      'asset-a',
      'video_step',
      'https://upstream.example.com/video.mp4',
      { providerId: 'volcengine-ark' }
    );

    expect(result).toEqual({ ok: true, key: 'wf-res-asset-a-video_step' });
    expect(fetchProviderArtifactBlob).toHaveBeenCalledWith({
      providerId: 'volcengine-ark',
      url: 'https://upstream.example.com/video.mp4',
    });
    expect(mocks.putCompanionAsset).toHaveBeenCalledWith(
      'http://127.0.0.1:18765',
      'project-a',
      'wf-res-asset-a-video_step',
      expect.any(Blob),
      'video/mp4'
    );
  });
});
