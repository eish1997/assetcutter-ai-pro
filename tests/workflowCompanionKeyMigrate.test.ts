import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowAsset } from '../types';

const storageMock = vi.hoisted(() => ({
  fetchCompanionAssetBlob: vi.fn(),
  getCompanionManifest: vi.fn(),
  importCompanionAssetFromUrl: vi.fn(),
  listCompanionProjects: vi.fn(),
  putCompanionAsset: vi.fn(),
}));

vi.mock('../services/companionClient/storage', () => storageMock);

import {
  canonicalizeWorkflowCompanionObjectKey,
  isCanonicalWorkflowCompanionObjectKey,
  isHashedWorkflowGridThumbCacheKey,
  migrateWorkflowAssetCompanionKeysToCanonical,
  parseCanonicalCompanionObjectKey,
  workflowImageCompanionStorageKey,
  workflowImagePreviewCompanionStorageKey,
  workflowOriginalCompanionStorageKey,
} from '../services/workflowCompanionAssets';
import { applyCompanionHydratePatches } from '../services/workflowCompanionLazyHydrate';

const ASSET_ID = '550e8400-e29b-41d4-a716-446655440000';
const ID8 = '550e8400';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function okBlob(bytes = PNG) {
  return { ok: true as const, data: bytes.buffer, status: 200, latencyMs: 1 };
}
function notFound() {
  return { ok: false as const, error: 'HTTP 404', status: 404, latencyMs: 1 };
}

function makeAsset(partial?: Partial<WorkflowAsset>): WorkflowAsset {
  return {
    id: ASSET_ID,
    original: '',
    displayKey: 'original',
    results: {},
    resultOrder: [],
    archived: false,
    hiddenInGrid: false,
    createdAt: 1,
    ...partial,
  };
}

describe('canonical companion object keys', () => {
  it('parses the generate/load shared pattern', () => {
    const key = `${ASSET_ID}/image-thumb-1-${ID8}.jpg`;
    expect(isCanonicalWorkflowCompanionObjectKey(key)).toBe(true);
    expect(parseCanonicalCompanionObjectKey(key)).toEqual({
      assetId: ASSET_ID,
      mediaKind: 'image',
      role: 'thumb',
      slot: 1,
      id8: ID8,
      ext: 'jpg',
    });
    expect(isHashedWorkflowGridThumbCacheKey(`${ASSET_ID}/thumb-th-4g-abc123.jpg`)).toBe(true);
    expect(isHashedWorkflowGridThumbCacheKey(key)).toBe(false);
  });

  it('maps legacy result/original/preview names onto the same generate keys', () => {
    expect(
      canonicalizeWorkflowCompanionObjectKey(`${ASSET_ID}/original-image-${ASSET_ID}.png`, {
        assetId: ASSET_ID,
        mediaKind: 'image',
        role: 'full',
        slot: 0,
      })
    ).toBe(workflowOriginalCompanionStorageKey(ASSET_ID, 'png'));
    expect(
      canonicalizeWorkflowCompanionObjectKey(`${ASSET_ID}/result-text_to_image.png`, {
        assetId: ASSET_ID,
        mediaKind: 'image',
        role: 'full',
        slot: 1,
        ext: 'png',
      })
    ).toBe(workflowImageCompanionStorageKey(ASSET_ID, 1, 'png'));
    expect(
      canonicalizeWorkflowCompanionObjectKey(`${ASSET_ID}/preview-0.jpg`, {
        assetId: ASSET_ID,
        mediaKind: 'image',
        role: 'thumb',
        slot: 0,
      })
    ).toBe(workflowImagePreviewCompanionStorageKey(ASSET_ID, 0, 'jpg'));
  });
});

describe('migrateWorkflowAssetCompanionKeysToCanonical', () => {
  afterEach(() => {
    storageMock.fetchCompanionAssetBlob.mockReset();
    storageMock.getCompanionManifest.mockReset();
    storageMock.listCompanionProjects.mockReset();
    storageMock.putCompanionAsset.mockReset();
  });

  function stubProjectsEmpty() {
    storageMock.listCompanionProjects.mockResolvedValue({ ok: true, data: { projectIds: [] } });
    storageMock.getCompanionManifest.mockResolvedValue({ ok: true, data: { entries: [] } });
  }

  it('copies original-image / result-* / preview-* bytes onto canonical keys and rewrites JSON', async () => {
    stubProjectsEmpty();
    const storedOrig = `${ASSET_ID}/original-image-${ASSET_ID}.png`;
    const storedResult = `${ASSET_ID}/result-text_to_image.png`;
    const storedPreview = `${ASSET_ID}/preview-0.jpg`;
    const canonicalOrig = `${ASSET_ID}/image-full-0-${ID8}.png`;
    const canonicalResult = `${ASSET_ID}/image-full-0-${ID8}.png`;
    const canonicalPreview = `${ASSET_ID}/image-thumb-0-${ID8}.jpg`;

    storageMock.fetchCompanionAssetBlob.mockImplementation(async (_b: string, _p: string, key: string) => {
      if (key === storedOrig || key === storedResult || key === storedPreview) return okBlob();
      return notFound();
    });
    storageMock.putCompanionAsset.mockResolvedValue({ ok: true, data: { key: 'x' } });

    const { asset, changed } = await migrateWorkflowAssetCompanionKeysToCanonical(
      makeAsset({
        originalCompanionKey: storedOrig,
        resultOrder: ['text_to_image'],
        resultsCompanionKeys: { text_to_image: storedResult },
        resultsPreviewCompanionKeys: { original: storedPreview },
      }),
      'http://127.0.0.1:18765',
      'proj'
    );

    expect(changed).toBe(true);
    expect(asset.originalCompanionKey).toBe(canonicalOrig);
    expect(asset.resultsCompanionKeys?.text_to_image).toBe(canonicalResult);
    expect(asset.resultsPreviewCompanionKeys?.original).toBe(canonicalPreview);
    const putKeys = storageMock.putCompanionAsset.mock.calls.map((c) => c[2]);
    expect(putKeys).toContain(canonicalOrig);
    expect(putKeys).toContain(canonicalPreview);
  });

  it('rewrites JSON onto an already-present canonical key without PUT', async () => {
    stubProjectsEmpty();
    const stored = `${ASSET_ID}/original-image-${ASSET_ID}.png`;
    const canonical = `${ASSET_ID}/image-full-0-${ID8}.png`;
    storageMock.fetchCompanionAssetBlob.mockImplementation(async (_b: string, _p: string, key: string) => {
      if (key === canonical) return okBlob();
      return notFound();
    });

    const { asset, changed } = await migrateWorkflowAssetCompanionKeysToCanonical(
      makeAsset({ originalCompanionKey: stored }),
      'http://127.0.0.1:18765',
      'proj'
    );

    expect(changed).toBe(true);
    expect(asset.originalCompanionKey).toBe(canonical);
    expect(storageMock.putCompanionAsset).not.toHaveBeenCalled();
  });

  it('copies hashed thumb-mi/th preview cache onto image-thumb and updates the pointer', async () => {
    stubProjectsEmpty();
    const hashed = `${ASSET_ID}/thumb-th-4g-abc123.jpg`;
    const canonical = `${ASSET_ID}/image-thumb-0-${ID8}.jpg`;
    storageMock.fetchCompanionAssetBlob.mockImplementation(async (_b: string, _p: string, key: string) => {
      if (key === hashed) return okBlob();
      return notFound();
    });
    storageMock.putCompanionAsset.mockResolvedValue({ ok: true, data: { key: 'x' } });

    const { asset, changed } = await migrateWorkflowAssetCompanionKeysToCanonical(
      makeAsset({ resultsPreviewCompanionKeys: { original: hashed } }),
      'http://127.0.0.1:18765',
      'proj'
    );

    expect(changed).toBe(true);
    expect(asset.resultsPreviewCompanionKeys?.original).toBe(canonical);
    expect(storageMock.putCompanionAsset.mock.calls[0]?.[2]).toBe(canonical);
  });

  it('fills a missing preview pointer when image-thumb already exists on disk', async () => {
    stubProjectsEmpty();
    const full = `${ASSET_ID}/image-full-0-${ID8}.png`;
    const thumb = `${ASSET_ID}/image-thumb-0-${ID8}.jpg`;
    storageMock.fetchCompanionAssetBlob.mockImplementation(async (_b: string, _p: string, key: string) => {
      if (key === thumb) return okBlob();
      return notFound();
    });

    const { asset, changed } = await migrateWorkflowAssetCompanionKeysToCanonical(
      makeAsset({ originalCompanionKey: full }),
      'http://127.0.0.1:18765',
      'proj'
    );

    expect(changed).toBe(true);
    expect(asset.resultsPreviewCompanionKeys?.original).toBe(thumb);
    expect(storageMock.putCompanionAsset).not.toHaveBeenCalled();
  });

  it('does not rewrite SAM _mN sidecar keys', async () => {
    stubProjectsEmpty();
    storageMock.fetchCompanionAssetBlob.mockResolvedValue(notFound());
    const sam = `${ASSET_ID}/image-full-0-${ID8}.png_m1`;
    const { asset, changed } = await migrateWorkflowAssetCompanionKeysToCanonical(
      makeAsset({ originalCompanionKey: sam }),
      'http://127.0.0.1:18765',
      'proj'
    );
    expect(changed).toBe(false);
    expect(asset.originalCompanionKey).toBe(sam);
    expect(storageMock.putCompanionAsset).not.toHaveBeenCalled();
  });

  it('keeps the old JSON pointer when copy fails', async () => {
    stubProjectsEmpty();
    const stored = `${ASSET_ID}/original-image-${ASSET_ID}.png`;
    storageMock.fetchCompanionAssetBlob.mockResolvedValue(notFound());

    const { asset, changed } = await migrateWorkflowAssetCompanionKeysToCanonical(
      makeAsset({ originalCompanionKey: stored }),
      'http://127.0.0.1:18765',
      'proj'
    );
    expect(changed).toBe(false);
    expect(asset.originalCompanionKey).toBe(stored);
  });
});

describe('hydrate key patches', () => {
  it('applies migrated companion pointers onto the in-memory asset', () => {
    const prev = makeAsset({ originalCompanionKey: `${ASSET_ID}/original-image-${ASSET_ID}.png` });
    const nextKey = `${ASSET_ID}/image-full-0-${ID8}.png`;
    const out = applyCompanionHydratePatches([prev], [
      { assetId: ASSET_ID, kind: 'keys', originalCompanionKey: nextKey },
    ]);
    expect(out[0]?.originalCompanionKey).toBe(nextKey);
  });
});

describe('ProgressivePreviewImage generate/load contract', () => {
  it('does not read or write hashed thumb-mi/th companion cache keys', () => {
    const src = readFileSync(resolve('components/ProgressivePreviewImage.tsx'), 'utf8');
    expect(src).not.toContain('workflowPreviewThumbCompanionStorageKey');
    expect(src).not.toContain('putWorkflowPreviewThumbToCompanion');
    expect(src).not.toContain('fetchWorkflowPreviewThumbFromCompanion');
  });
});
