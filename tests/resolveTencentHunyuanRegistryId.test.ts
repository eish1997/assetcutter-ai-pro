import { describe, expect, it } from 'vitest';
import { resolveTencentHunyuanRegistryId } from '../services/generate3d/resolveProvider';

describe('resolveTencentHunyuanRegistryId (C9)', () => {
  it('prefers preset modelRegistryId', () => {
    expect(
      resolveTencentHunyuanRegistryId({
        provider: 'tencent',
        module: 'rapid',
        modelRegistryId: 'tencent-hunyuan-3d-pro',
      })
    ).toBe('tencent-hunyuan-3d-pro');
  });

  it('maps rapid/pro module when registry missing', () => {
    expect(resolveTencentHunyuanRegistryId({ provider: 'tencent', module: 'rapid' })).toBe(
      'tencent-hunyuan-3d-rapid'
    );
    expect(resolveTencentHunyuanRegistryId({ provider: 'tencent', module: 'pro' })).toBe(
      'tencent-hunyuan-3d-pro'
    );
  });
});
