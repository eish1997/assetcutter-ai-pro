import { describe, expect, it } from 'vitest';

import { normalizeGenerate3DPresetForRun, resolveGenerate3dProviderId, buildTripoCreateTaskInputFromPreset } from '../services/generate3d';
import type { Generate3DPreset } from '../types';

describe('generate3d adapter helpers', () => {
  it('normalizeGenerate3DPresetForRun 修正 module 与 pro 面数范围', () => {
    const g: Generate3DPreset = {
      module: 'pro',
      faceCount: 50,
      model: '3.0',
      resultFormat: 'INVALID',
    };
    const n = normalizeGenerate3DPresetForRun(g);
    expect(n.module).toBe('pro');
    expect(n.faceCount).toBe(10000);
    expect(n.resultFormat).toBeUndefined();
  });

  it('resolveGenerate3dProviderId 识别腾讯与默认 Tripo', () => {
    expect(resolveGenerate3dProviderId({ module: 'pro', provider: 'tencent' })).toBe('tencent');
    expect(resolveGenerate3dProviderId({ module: 'pro' })).toBe('tripo');
    expect(resolveGenerate3dProviderId({ module: 'rapid', provider: 'tripo' })).toBe('tripo');
  });

  it('maps Tripo registry ids to BYOK model versions', () => {
    const input = buildTripoCreateTaskInputFromPreset({
      apiKey: 'tsk_test',
      imageDataUrl: 'data:image/png;base64,AAAA',
      preset: {
        id: 'tripo31',
        label: 'Tripo 3.1',
        category: 'generate_3d',
        instruction: 'make a model',
        generate3D: {
          provider: 'tripo',
          module: 'pro',
          modelRegistryId: 'tripo-v3.1',
          tripoTaskType: 'image_to_model',
        },
      } as import('../types').CustomAppModule,
    });

    expect(input.modelVersion).toBe('v3.1-20260211');
  });

  it('passes Tripo quality and material parameters to the task input', () => {
    const input = buildTripoCreateTaskInputFromPreset({
      apiKey: 'tsk_test',
      imageDataUrl: 'data:image/png;base64,AAAA',
      preset: {
        id: 'tripo-params',
        label: 'Tripo params',
        category: 'generate_3d',
        instruction: 'make a model',
        generate3D: {
          provider: 'tripo',
          module: 'pro',
          modelRegistryId: 'tripo-p1',
          tripoTaskType: 'image_to_model',
          tripoGeometryQuality: 'detailed',
          tripoTextureQuality: 'detailed',
          tripoTexture: false,
          tripoPbr: false,
        },
      } as import('../types').CustomAppModule,
    });

    expect(input.geometryQuality).toBe('detailed');
    expect(input.textureQuality).toBe('detailed');
    expect(input.texture).toBe(false);
    expect(input.pbr).toBe(false);
  });
});
