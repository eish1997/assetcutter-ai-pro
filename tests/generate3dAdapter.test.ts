import { describe, expect, it } from 'vitest';

import { normalizeGenerate3DPresetForRun, resolveGenerate3dProviderId } from '../services/generate3d';
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
});
