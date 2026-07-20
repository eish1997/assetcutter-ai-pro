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

import { putWorkflowResultMediaFromAnyUrl } from '../services/workflowCompanionAssets';

describe('putWorkflowResultMediaFromAnyUrl', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mocks.importCompanionAssetFromUrl.mockReset();
    mocks.putCompanionAsset.mockReset();
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
});
