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
  workflowLegacyOriginalCompanionStorageKey,
  workflowOriginalModelCompanionStorageKey,
  workflowOriginalCompanionStorageKey,
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

  it('maps bare original keys to new full + legacy originals', () => {
    const candidates = legacyWorkflowCompanionAssetKeyCandidates('asset-1');
    expect(candidates).toContain(workflowOriginalCompanionStorageKey('asset-1'));
    expect(candidates).toContain('asset-1/original.jpg');
  });

  it('names original image/model with mediaKind-role-slot-id8', () => {
    expect(workflowOriginalCompanionStorageKey('asset-1', 'png')).toBe('asset-1/image-full-0-asset100.png');
    expect(workflowOriginalModelCompanionStorageKey('asset-1', 'fbx')).toBe('asset-1/model-full-0-asset100.fbx');
    expect(workflowLegacyOriginalCompanionStorageKey('asset-1', 'png')).toBe(
      'asset-1/original-image-asset-1.png'
    );
  });

  it('maps old asset/result companion keys to image + legacy result candidates', () => {
    const candidates = legacyWorkflowCompanionAssetKeyCandidates(
      'asset-1/ac_internal_quick_compose_plain_i2i'
    );
    expect(candidates.some((k) => k.includes('/image-full-'))).toBe(true);
    expect(candidates.some((k) => k.includes('/result-ac_internal_quick_compose_plain_i2i'))).toBe(true);
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
