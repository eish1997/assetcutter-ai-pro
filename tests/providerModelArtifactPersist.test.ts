import { describe, expect, it, vi } from 'vitest';

vi.mock('../services/providerArtifactFetch', () => ({
  fetchProviderArtifactBlob: vi.fn(),
}));

vi.mock('../services/workflowCompanionAssets', () => ({
  putWorkflowModelBlobToCompanion: vi.fn(),
  fetchWorkflowModelFromCompanionAsObjectUrl: vi.fn(),
  putWorkflowResultImageToCompanion: vi.fn(),
  fetchWorkflowOriginalFromCompanionAsObjectUrl: vi.fn(),
}));

import { fetchProviderArtifactBlob } from '../services/providerArtifactFetch';
import {
  fetchWorkflowModelFromCompanionAsObjectUrl,
  putWorkflowModelBlobToCompanion,
} from '../services/workflowCompanionAssets';
import {
  inferWorkflowModelFormatFromUrl,
  persistProviderModelArtifactsForWorkflowAsset,
} from '../services/providerModelArtifactPersist';

describe('provider model artifact persistence', () => {
  it('infers common 3D model formats from URL and MIME type', () => {
    expect(inferWorkflowModelFormatFromUrl('https://cdn.test/model.glb')).toBe('glb');
    expect(inferWorkflowModelFormatFromUrl('https://cdn.test/model.gltf')).toBe('gltf');
    expect(inferWorkflowModelFormatFromUrl('https://cdn.test/model.fbx?token=1')).toBe('fbx');
    expect(inferWorkflowModelFormatFromUrl('https://cdn.test/model.obj')).toBe('obj');
    expect(inferWorkflowModelFormatFromUrl('https://cdn.test/model.usdz')).toBe('usdz');
    expect(inferWorkflowModelFormatFromUrl('https://cdn.test/download', 'application/zip')).toBe('zip');
  });

  it('fetches provider model files and persists them through local companion', async () => {
    vi.mocked(fetchProviderArtifactBlob).mockResolvedValue(
      new Blob(['model'], { type: 'model/gltf-binary' })
    );
    vi.mocked(putWorkflowModelBlobToCompanion).mockResolvedValue({
      ok: true,
      key: 'models/asset_1/slot_0.glb',
    });
    vi.mocked(fetchWorkflowModelFromCompanionAsObjectUrl).mockResolvedValue({
      ok: true,
      objectUrl: 'blob:local-model',
    });

    const persisted = await persistProviderModelArtifactsForWorkflowAsset({
      providerId: 'volcengine-ark',
      taskId: 'aijob_1',
      assetId: 'asset_1',
      resultKey: 'seed3d',
      modelUrls: ['https://ark.example.com/model.glb'],
      companionBaseUrl: 'http://127.0.0.1:17600',
      companionProjectId: 'project_1',
    });

    expect(fetchProviderArtifactBlob).toHaveBeenCalledWith({
      providerId: 'volcengine-ark',
      url: 'https://ark.example.com/model.glb',
    });
    expect(putWorkflowModelBlobToCompanion).toHaveBeenCalledWith(
      'http://127.0.0.1:17600',
      'project_1',
      'asset_1',
      0,
      expect.any(Blob),
      'volcengine-ark_aijob_1_glb'
    );
    expect(persisted).toMatchObject({
      modelUrls: ['blob:local-model'],
      modelCompanionKeys: ['models/asset_1/slot_0.glb'],
      stepModelFormats: ['glb'],
      modelSourceName: 'models/asset_1/slot_0.glb',
    });
  });
});
