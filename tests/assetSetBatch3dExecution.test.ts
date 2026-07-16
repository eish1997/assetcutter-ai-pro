import { describe, expect, it, vi } from 'vitest';

vi.mock('../services/aiGatewayModel3dExecution', () => ({
  createAndPollAiGatewayModel3dJob: vi.fn(),
}));

import { runAssetSetComponent3d } from '../services/assetSet/assetSetBatch3d';
import { createAndPollAiGatewayModel3dJob } from '../services/aiGatewayModel3dExecution';
import type { AssetSetComponent, CustomAppModule } from '../types';

describe('assetSetBatch3d execution routing', () => {
  it('routes Ark Seed3D asset-set jobs through AI Gateway instead of Tripo', async () => {
    vi.mocked(createAndPollAiGatewayModel3dJob).mockResolvedValue({
      aiGatewayJobId: 'aijob_seed3d_assetset_1',
      modelUrls: ['https://cdn.example.com/seed3d.glb'],
      previewUrl: 'https://cdn.example.com/seed3d.png',
    });

    const preset = {
      id: 'seed3d',
      label: 'Seed3D',
      category: 'generate_3d',
      instruction: 'make a clean 3D prop',
      generate3D: {
        provider: 'volcengine-ark',
        module: 'pro',
        modelRegistryId: 'doubao-seed3d-2-0',
        quality: 'high',
        format: 'glb',
        texture: true,
      },
    } as CustomAppModule;
    const component = {
      id: 'component_1',
      index: 0,
      cropSource: 'styled',
      cropRegion: { id: 'box_1', label: '1', xmin: 0, ymin: 0, xmax: 10, ymax: 10 },
      views: [{ id: 'view_1', role: 'front', image: 'data:image/png;base64,AAAA' }],
    } as AssetSetComponent;

    await expect(
      runAssetSetComponent3d({
        apiKey: '',
        preset,
        component,
      })
    ).resolves.toEqual({
      ok: true,
      jobId: 'aijob_seed3d_assetset_1',
      provider: 'volcengine-ark',
      files: ['https://cdn.example.com/seed3d.glb'],
      previewUrl: 'https://cdn.example.com/seed3d.png',
    });

    expect(createAndPollAiGatewayModel3dJob).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'make a clean 3D prop',
        referenceImages: ['data:image/png;base64,AAAA'],
        registryId: 'doubao-seed3d-2-0',
        quality: 'high',
        format: 'glb',
        texture: true,
      })
    );
  });
});
