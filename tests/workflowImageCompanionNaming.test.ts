import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  importCompanionAssetFromUrl: vi.fn(),
  putCompanionAsset: vi.fn(),
  fetchMediaUrlViaAuthApi: vi.fn(),
  createPreviewThumbnail: vi.fn(),
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

vi.mock('../services/workflowImageThumb', () => ({
  createPreviewThumbnail: mocks.createPreviewThumbnail,
}));

import {
  companionAssetId8,
  putWorkflowOriginalImageToCompanion,
  putWorkflowResultImageToCompanion,
  resolveWorkflowImageSlotIndex,
  workflowCompanionObjectKey,
  workflowImageCompanionStorageKey,
  workflowImagePreviewCompanionStorageKey,
  workflowImageThumbKeyFromFullKey,
  workflowLegacyResultCompanionStorageKey,
  workflowModelCompanionStorageKey,
  workflowOriginalCompanionStorageKey,
  workflowVideoCompanionStorageKey,
} from '../services/workflowCompanionAssets';

const ASSET_ID = '550e8400-e29b-41d4-a716-446655440000';
const ID8 = '550e8400';

describe('workflow companion naming (mediaKind-role-slot-id8)', () => {
  afterEach(() => {
    mocks.importCompanionAssetFromUrl.mockReset();
    mocks.putCompanionAsset.mockReset();
    mocks.fetchMediaUrlViaAuthApi.mockReset();
    mocks.createPreviewThumbnail.mockReset();
  });

  it('builds id8 and object keys as planned', () => {
    expect(companionAssetId8(ASSET_ID)).toBe(ID8);
    expect(workflowCompanionObjectKey({
      assetId: ASSET_ID,
      mediaKind: 'image',
      role: 'full',
      slot: 0,
      ext: 'png',
    })).toBe(`${ASSET_ID}/image-full-0-${ID8}.png`);
    expect(workflowImageCompanionStorageKey(ASSET_ID, 0, 'png')).toBe(`${ASSET_ID}/image-full-0-${ID8}.png`);
    expect(workflowImagePreviewCompanionStorageKey(ASSET_ID, 0, 'jpg')).toBe(
      `${ASSET_ID}/image-thumb-0-${ID8}.jpg`
    );
    expect(workflowImageThumbKeyFromFullKey(`${ASSET_ID}/image-full-0-${ID8}.png`)).toBe(
      `${ASSET_ID}/image-thumb-0-${ID8}.jpg`
    );
    expect(workflowImageThumbKeyFromFullKey('result-old.png')).toBe('');
    expect(workflowModelCompanionStorageKey(ASSET_ID, 0, 'glb')).toBe(`${ASSET_ID}/model-full-0-${ID8}.glb`);
    expect(workflowVideoCompanionStorageKey(ASSET_ID, 1, 'mp4')).toBe(`${ASSET_ID}/video-full-1-${ID8}.mp4`);
    expect(workflowOriginalCompanionStorageKey(ASSET_ID, 'png', 'image')).toBe(
      `${ASSET_ID}/image-full-0-${ID8}.png`
    );
    expect(workflowLegacyResultCompanionStorageKey(ASSET_ID, 'text_to_image', 'png')).toContain(
      'result-text_to_image'
    );
  });

  it('resolves slot from resultOrder', () => {
    expect(resolveWorkflowImageSlotIndex(['a', 'b'], 'b')).toBe(1);
    expect(resolveWorkflowImageSlotIndex(['a'], 'new')).toBe(1);
  });

  it('writes image-full + image-thumb sidecar on persist', async () => {
    mocks.putCompanionAsset.mockResolvedValue({ ok: true, data: { key: 'x' } });
    // 用合法 base64（内容可为 PNG 字节）保证 sidecar PUT 路径可解析
    mocks.createPreviewThumbnail.mockResolvedValue(
      'data:image/jpeg;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    );

    const png =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

    const out = await putWorkflowResultImageToCompanion(
      'http://127.0.0.1:18765',
      'proj',
      ASSET_ID,
      'text_to_image',
      png,
      { slotIndex: 0 }
    );

    expect(out.ok).toBe(true);
    if (out.ok !== true) return;
    expect(out.key).toBe(`${ASSET_ID}/image-full-0-${ID8}.png`);
    expect(out.previewKey).toBe(`${ASSET_ID}/image-thumb-0-${ID8}.jpg`);
    expect(mocks.putCompanionAsset).toHaveBeenCalledTimes(2);
    expect(mocks.putCompanionAsset.mock.calls[0]?.[2]).toBe(`${ASSET_ID}/image-full-0-${ID8}.png`);
    expect(mocks.putCompanionAsset.mock.calls[1]?.[2]).toBe(`${ASSET_ID}/image-thumb-0-${ID8}.jpg`);
  });

  it('writes image-full + image-thumb sidecar for original persist', async () => {
    mocks.putCompanionAsset.mockResolvedValue({ ok: true, data: { key: 'x' } });
    mocks.createPreviewThumbnail.mockResolvedValue(
      'data:image/jpeg;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    );
    const png =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const out = await putWorkflowOriginalImageToCompanion('http://127.0.0.1:18765', 'proj', ASSET_ID, png);
    expect(out.ok).toBe(true);
    if (out.ok !== true) return;
    expect(out.key).toBe(`${ASSET_ID}/image-full-0-${ID8}.png`);
    expect(out.previewKey).toBe(`${ASSET_ID}/image-thumb-0-${ID8}.jpg`);
  });
});
