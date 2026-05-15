import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../services/companionClient/probe', () => ({
  probeCompanionHealth: vi.fn(),
}));

vi.mock('../services/companionClient/storage', () => ({
  fetchCompanionAssetBlob: vi.fn(),
  fetchCompanionAssetForDownload: vi.fn(),
}));

vi.mock('../services/workflowModelBlob', () => ({
  isWorkflowModelUrlReadable: vi.fn(),
}));

import { probeCompanionHealth } from '../services/companionClient/probe';
import { fetchCompanionAssetBlob, fetchCompanionAssetForDownload } from '../services/companionClient/storage';
import { isWorkflowModelUrlReadable } from '../services/workflowModelBlob';
import { __downloadModelFileTest } from '../services/downloadModelFile';

describe('downloadModelFile', () => {
  beforeEach(() => {
    __downloadModelFileTest.clearCompanionReachableCacheForTests();
    vi.mocked(probeCompanionHealth).mockReset();
    vi.mocked(fetchCompanionAssetBlob).mockReset();
    vi.mocked(fetchCompanionAssetForDownload).mockReset();
    vi.mocked(isWorkflowModelUrlReadable).mockReset();
  });

  it('exports download helpers', async () => {
    const mod = await import('../services/downloadModelFile');
    expect(typeof mod.downloadModelFromSource).toBe('function');
    expect(typeof mod.downloadWorkflowStepModelSlot).toBe('function');
  });

  it('resolveModelBlob prefers companion when reachable', async () => {
    vi.mocked(probeCompanionHealth).mockResolvedValue({ ok: true });
    vi.mocked(fetchCompanionAssetForDownload).mockResolvedValue({
      ok: true,
      data: { blob: new Blob(['x'], { type: 'model/gltf-binary' }), filename: 'model.glb' },
      latencyMs: 1,
      status: 200,
    });
    const r = await __downloadModelFileTest.resolveModelBlob({
      url: 'blob:dead',
      companionBaseUrl: 'http://127.0.0.1:18765',
      companionProjectId: 'proj1',
      companionKey: 'wf-mdl-key',
    });
    expect(fetchCompanionAssetForDownload).toHaveBeenCalled();
    expect(r.resolvedUrl).toBe('wf-mdl-key');
  });

  it('resolveModelBlob uses readable blob when companion offline', async () => {
    vi.mocked(probeCompanionHealth).mockResolvedValue({ ok: false });
    vi.mocked(isWorkflowModelUrlReadable).mockResolvedValue(true);
    vi.mocked(fetchCompanionAssetBlob).mockResolvedValue({ ok: false, error: 'offline' });
    const blob = new Blob(['x'], { type: 'model/gltf-binary' });
    const blobUrl = 'blob:alive';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => blob,
    });
    vi.stubGlobal('fetch', fetchMock);
    const r = await __downloadModelFileTest.resolveModelBlob({
      url: blobUrl,
      companionBaseUrl: 'http://127.0.0.1:18765',
      companionProjectId: 'proj1',
      companionKey: 'wf-mdl-key',
    });
    expect(r.resolvedUrl).toBe(blobUrl);
    expect(fetchMock).toHaveBeenCalledWith(blobUrl);
    vi.unstubAllGlobals();
  });
});
