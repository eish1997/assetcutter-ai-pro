import { beforeEach, describe, expect, it, vi } from 'vitest';

const storageMock = vi.hoisted(() => ({
  fetchCompanionAssetBlob: vi.fn(),
  getCompanionManifest: vi.fn(),
  importCompanionAssetFromUrl: vi.fn(),
  listCompanionProjects: vi.fn(),
  putCompanionAsset: vi.fn(),
}));

vi.mock('../services/companionClient/storage', () => storageMock);

import {
  fetchWorkflowOriginalFromCompanionAsObjectUrl,
  legacyWorkflowCompanionAssetKeyCandidates,
  workflowOriginalCompanionStorageKey,
  workflowResultCompanionStorageKey,
} from '../services/workflowCompanionAssets';

describe('workflow companion legacy key fallback', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    storageMock.fetchCompanionAssetBlob.mockReset();
    storageMock.getCompanionManifest.mockReset();
    storageMock.importCompanionAssetFromUrl.mockReset();
    storageMock.listCompanionProjects.mockReset();
    storageMock.putCompanionAsset.mockReset();
    storageMock.listCompanionProjects.mockResolvedValue({ ok: true, data: { projectIds: [] } });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:restored');
  });

  it('maps old original companion keys to stable wf-orig keys', () => {
    expect(legacyWorkflowCompanionAssetKeyCandidates('asset-1')).toEqual([
      workflowOriginalCompanionStorageKey('asset-1'),
    ]);
  });

  it('maps old asset/result companion keys to stable wf-res keys', () => {
    expect(legacyWorkflowCompanionAssetKeyCandidates('asset-1/ac_internal_quick_compose_plain_i2i')).toEqual([
      workflowResultCompanionStorageKey('asset-1', 'ac_internal_quick_compose_plain_i2i'),
    ]);
  });

  it('restores an old bare original key after the direct lookup returns 404', async () => {
    storageMock.fetchCompanionAssetBlob.mockImplementation(async (_base: string, _pid: string, key: string) => {
      if (key === workflowOriginalCompanionStorageKey('asset-1')) {
        return { ok: true, data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer, status: 200, latencyMs: 1 };
      }
      return { ok: false, error: 'HTTP 404', status: 404, latencyMs: 1 };
    });

    const got = await fetchWorkflowOriginalFromCompanionAsObjectUrl('http://127.0.0.1:18765', 'proj-1', 'asset-1');

    expect(got).toEqual({ ok: true, objectUrl: 'blob:restored', mime: 'image/png' });
    expect(storageMock.fetchCompanionAssetBlob).toHaveBeenCalledWith(
      'http://127.0.0.1:18765',
      'proj-1',
      'asset-1'
    );
    expect(storageMock.fetchCompanionAssetBlob).toHaveBeenCalledWith(
      'http://127.0.0.1:18765',
      'proj-1',
      workflowOriginalCompanionStorageKey('asset-1')
    );
  });
});
