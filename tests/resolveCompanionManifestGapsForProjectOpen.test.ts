import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompanionManifestV1 } from '../services/companionClient/storage';
import type { WorkflowAsset } from '../types';
import { workflowModelCompanionStorageKey } from '../services/workflowCompanionAssets';

const getCompanionAssetMeta = vi.fn();

vi.mock('../services/companionClient/storage', () => ({
  getCompanionAssetMeta: (...args: unknown[]) => getCompanionAssetMeta(...args),
}));

const putWorkflowModelBlobToCompanion = vi.fn();
const putWorkflowOriginalImageToCompanion = vi.fn();
const putWorkflowResultImageToCompanion = vi.fn();

vi.mock('../services/workflowCompanionAssets', async () => {
  const actual = await vi.importActual<typeof import('../services/workflowCompanionAssets')>(
    '../services/workflowCompanionAssets'
  );
  return {
    ...actual,
    putWorkflowModelBlobToCompanion: (...args: unknown[]) => putWorkflowModelBlobToCompanion(...args),
    putWorkflowOriginalImageToCompanion: (...args: unknown[]) => putWorkflowOriginalImageToCompanion(...args),
    putWorkflowResultImageToCompanion: (...args: unknown[]) => putWorkflowResultImageToCompanion(...args),
  };
});

import { resolveCompanionManifestGapsForProjectOpen } from '../services/workflowManifestCrossCheck';

function man(entries: CompanionManifestV1['entries'], projectId = 'proj-1'): CompanionManifestV1 {
  return { layoutVersion: 1, projectId, updatedAt: 1, entries };
}

describe('resolveCompanionManifestGapsForProjectOpen', () => {
  beforeEach(() => {
    getCompanionAssetMeta.mockReset();
    putWorkflowModelBlobToCompanion.mockReset();
    putWorkflowOriginalImageToCompanion.mockReset();
    putWorkflowResultImageToCompanion.mockReset();
  });

  it('does not clean 3D model keys that reappear in manifest after repair/reconcile', async () => {
    const assetId = '550e8400-e29b-41d4-a716-446655440000';
    const modelKey = workflowModelCompanionStorageKey(assetId, 0, 'glb');
    const asset = {
      id: assetId,
      original: '',
      displayKey: 'generate_3d',
      results: { generate_3d: 'https://cdn.example.com/preview.jpg' },
      resultOrder: ['generate_3d'],
      modelUrls: [''],
      modelCompanionKeys: [modelKey],
      stepModelCompanionKeys: { generate_3d: [modelKey] },
      archived: false,
      hiddenInGrid: false,
      createdAt: 1,
    } satisfies WorkflowAsset;

    const emptyManifest = man([]);
    const restoredManifest = man([
      {
        key: modelKey,
        relPath: `assets/${modelKey}`,
        byteSize: 10,
        tags: [],
        lineage: null,
        updatedAt: 1,
        mime: 'model/gltf-binary',
      },
    ]);

    getCompanionAssetMeta.mockResolvedValue({ ok: true, data: { onDisk: true } });

    const result = await resolveCompanionManifestGapsForProjectOpen({
      baseUrl: 'http://127.0.0.1:18765',
      projectId: 'proj-1',
      assets: [asset],
      manifest: emptyManifest,
      reconcile: async () => ({ ok: true, data: { added: 1, keys: [modelKey] } }),
      refetchManifest: async () => ({ ok: true, data: restoredManifest }),
    });

    expect(result.initialGaps.some((g) => g.kind === 'model' && g.key === modelKey)).toBe(true);
    expect(result.gapsToClean).toEqual([]);
    expect(result.manifest.entries.some((e) => e.key === modelKey)).toBe(true);
  });

  it('keeps project model key when file is on disk even if manifest refresh still lags', async () => {
    const assetId = '550e8400-e29b-41d4-a716-446655440000';
    const modelKey = workflowModelCompanionStorageKey(assetId, 0, 'glb');
    const asset = {
      id: assetId,
      original: '',
      displayKey: 'generate_3d',
      results: { generate_3d: 'https://cdn.example.com/preview.jpg' },
      resultOrder: ['generate_3d'],
      modelCompanionKeys: [modelKey],
      stepModelCompanionKeys: { generate_3d: [modelKey] },
      archived: false,
      hiddenInGrid: false,
      createdAt: 1,
    } satisfies WorkflowAsset;

    getCompanionAssetMeta.mockResolvedValue({ ok: true, data: { onDisk: true } });

    const result = await resolveCompanionManifestGapsForProjectOpen({
      baseUrl: 'http://127.0.0.1:18765',
      projectId: 'proj-1',
      assets: [asset],
      manifest: man([]),
      reconcile: async () => ({ ok: true, data: { added: 0, keys: [] } }),
      refetchManifest: async () => ({ ok: true, data: man([]) }),
    });

    expect(result.initialGaps.length).toBeGreaterThan(0);
    expect(result.gapsToClean).toEqual([]);
  });

  it('only cleans model keys that remain missing and are absent on disk', async () => {
    const assetId = '550e8400-e29b-41d4-a716-446655440000';
    const modelKey = workflowModelCompanionStorageKey(assetId, 0, 'glb');
    const asset = {
      id: assetId,
      original: '',
      displayKey: 'generate_3d',
      results: { generate_3d: 'https://cdn.example.com/preview.jpg' },
      resultOrder: ['generate_3d'],
      modelCompanionKeys: [modelKey],
      stepModelCompanionKeys: { generate_3d: [modelKey] },
      archived: false,
      hiddenInGrid: false,
      createdAt: 1,
    } satisfies WorkflowAsset;

    getCompanionAssetMeta.mockResolvedValue({ ok: true, data: { onDisk: false } });

    const result = await resolveCompanionManifestGapsForProjectOpen({
      baseUrl: 'http://127.0.0.1:18765',
      projectId: 'proj-1',
      assets: [asset],
      manifest: man([]),
      reconcile: async () => ({ ok: true, data: { added: 0, keys: [] } }),
      refetchManifest: async () => ({ ok: true, data: man([]) }),
    });

    expect(result.gapsToClean.some((g) => g.kind === 'model' && g.key === modelKey)).toBe(true);
    expect(result.gapsToClean.every((g) => g.key === modelKey)).toBe(true);
  });

  it('does not clean when disk probe fails (network / companion down)', async () => {
    const assetId = '550e8400-e29b-41d4-a716-446655440000';
    const modelKey = workflowModelCompanionStorageKey(assetId, 0, 'glb');
    const asset = {
      id: assetId,
      original: '',
      displayKey: 'generate_3d',
      results: { generate_3d: 'https://cdn.example.com/preview.jpg' },
      resultOrder: ['generate_3d'],
      modelCompanionKeys: [modelKey],
      stepModelCompanionKeys: { generate_3d: [modelKey] },
      archived: false,
      hiddenInGrid: false,
      createdAt: 1,
    } satisfies WorkflowAsset;

    getCompanionAssetMeta.mockResolvedValue({ ok: false, error: 'fetch failed', status: 0 });

    const result = await resolveCompanionManifestGapsForProjectOpen({
      baseUrl: 'http://127.0.0.1:18765',
      projectId: 'proj-1',
      assets: [asset],
      manifest: man([]),
      reconcile: async () => ({ ok: true, data: { added: 0, keys: [] } }),
      refetchManifest: async () => ({ ok: true, data: man([]) }),
    });

    expect(result.initialGaps.length).toBeGreaterThan(0);
    expect(result.gapsToClean).toEqual([]);
  });
});
