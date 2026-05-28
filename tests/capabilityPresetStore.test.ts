import { describe, expect, it } from 'vitest';

import type { CustomAppModule } from '../types';
import { normalizeCapabilityPreset, enforceBuiltinImageProcessPresets } from '../services/capabilityPresetStore';

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

describe('normalizeCapabilityPreset: image_process category', () => {
  it('将 legacy image_to_image + builtin 归一为 image_process', () => {
    const input = makeBasePreset({ category: 'image_to_image', engine: 'builtin', id: 'custom_cut' });
    const normalized = normalizeCapabilityPreset(input, 0);
    expect(normalized.category).toBe('image_process');
    expect(normalized.engine).toBe('builtin');
  });

  it('cut_image 归一化后写入 processor 与 params', () => {
    const input = makeBasePreset({
      id: 'cut_image',
      category: 'image_process',
      engine: 'builtin',
      cutMode: 'uniform',
      uniformRows: 3,
      uniformCols: 4,
    });
    const normalized = normalizeCapabilityPreset(input, 0);
    expect(normalized.processor).toBe('cut_image');
    expect(normalized.params?.cutMode).toBe('uniform');
    expect(normalized.params?.uniformRows).toBe(3);
    expect(normalized.params?.uniformCols).toBe(4);
  });
});

describe('normalizeCapabilityPreset: companionHostBundle', () => {
  it('legacy 图生图 + 扩展包 归一为 image_process + host_bundle', () => {
    const input = makeBasePreset({
      companionHostBundle: { dirName: '  demo-bundle  ', phase: 'probe' },
      engine: 'gen_image',
    });
    const normalized = normalizeCapabilityPreset(input, 0);
    expect(normalized.category).toBe('image_process');
    expect(normalized.processor).toBe('host_bundle');
    expect(normalized.companionHostBundle).toEqual({ dirName: 'demo-bundle', phase: 'probe' });
    expect(normalized.engine).toBe('builtin');
  });

  it('phase 非 probe/exec 时回退为默认 exec（即不写 phase）', () => {
    const input = makeBasePreset({
      category: 'image_process',
      processor: 'host_bundle',
      engine: 'builtin',
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
      category: 'image_process',
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

describe('enforceBuiltinImageProcessPresets', () => {
  it('内置 cut_image 保持 image_process 类目', () => {
    const merged = enforceBuiltinImageProcessPresets([
      makeBasePreset({ id: 'cut_image', category: 'image_to_image', engine: 'builtin', cutMode: 'auto' }),
    ]);
    const cut = merged.find((p) => p.id === 'cut_image');
    expect(cut?.category).toBe('image_process');
    expect(cut?.processor).toBe('cut_image');
  });
});
