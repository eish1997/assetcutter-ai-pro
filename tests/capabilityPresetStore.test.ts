import { describe, expect, it } from 'vitest';

import type { CustomAppModule } from '../types';
import { normalizeCapabilityPreset } from '../services/capabilityPresetStore';

function makeBasePreset(partial?: Partial<CustomAppModule>): CustomAppModule {
  return {
    id: 'p1',
    label: '测试预设',
    category: 'image_to_image',
    instruction: '',
    engine: 'gen_image',
    ...partial,
  };
}

describe('normalizeCapabilityPreset: companionHostBundle', () => {
  it('保留并裁剪 dirName，phase=probe 时显式保留', () => {
    const input = makeBasePreset({
      companionHostBundle: { dirName: '  demo-bundle  ', phase: 'probe' },
      engine: 'gen_image',
    });
    const normalized = normalizeCapabilityPreset(input, 0);
    expect(normalized.companionHostBundle).toEqual({ dirName: 'demo-bundle', phase: 'probe' });
    expect(normalized.engine).toBe('builtin');
  });

  it('phase 非 probe/exec 时回退为默认 exec（即不写 phase）', () => {
    const input = makeBasePreset({
      companionHostBundle: { dirName: 'demo-bundle', phase: 'unknown' as 'exec' },
    });
    const normalized = normalizeCapabilityPreset(input, 0);
    expect(normalized.companionHostBundle).toEqual({ dirName: 'demo-bundle' });
    expect(normalized.engine).toBe('builtin');
  });

  it('dirName 为空白时移除 companionHostBundle', () => {
    const input = makeBasePreset({
      companionHostBundle: { dirName: '   ', phase: 'probe' },
    });
    const normalized = normalizeCapabilityPreset(input, 0);
    expect(normalized.companionHostBundle).toBeUndefined();
  });

  it('cut_image 强制移除 companionHostBundle', () => {
    const input = makeBasePreset({
      id: 'cut_image',
      companionHostBundle: { dirName: 'demo-bundle', phase: 'probe' },
      engine: 'builtin',
    });
    const normalized = normalizeCapabilityPreset(input, 0);
    expect(normalized.companionHostBundle).toBeUndefined();
  });

  it('generate_3d 强制移除 companionHostBundle', () => {
    const input = makeBasePreset({
      id: 'g3d',
      category: 'generate_3d',
      companionHostBundle: { dirName: 'demo-bundle', phase: 'probe' },
    });
    const normalized = normalizeCapabilityPreset(input, 0);
    expect(normalized.companionHostBundle).toBeUndefined();
  });
});
