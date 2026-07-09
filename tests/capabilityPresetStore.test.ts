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

  it('cut_image 归一化后写入 processor 与 params，并清除顶层旧字段', () => {
    const input = makeBasePreset({
      id: 'cut_image',
      category: 'image_process',
      engine: 'builtin',
      cutMode: 'uniform',
      uniformRows: 3,
      uniformCols: 4,
    } as CustomAppModule & { cutMode: 'uniform'; uniformRows: number; uniformCols: number });
    const normalized = normalizeCapabilityPreset(input, 0);
    expect(normalized.processor).toBe('cut_image');
    expect(normalized.params?.cutMode).toBe('uniform');
    expect(normalized.params?.uniformRows).toBe(3);
    expect(normalized.params?.uniformCols).toBe(4);
    expect((normalized as { cutMode?: string }).cutMode).toBeUndefined();
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
  it('enforceBuiltinImageProcessPresets：迁移顶层 cutMode 到 params', () => {
    const merged = enforceBuiltinImageProcessPresets([
      makeBasePreset({
        id: 'cut_image',
        category: 'image_to_image',
        engine: 'builtin',
        cutMode: 'auto',
      } as CustomAppModule & { cutMode: 'auto' }),
    ]);
    const cut = merged.find((p) => p.id === 'cut_image');
    expect(cut?.category).toBe('image_process');
    expect(cut?.processor).toBe('cut_image');
    expect(cut?.params?.cutMode).toBe('auto');
    expect((cut as { cutMode?: string } | undefined)?.cutMode).toBeUndefined();
  });
});

describe('normalizeCapabilityPreset: skipUnderstand seed defaults', () => {
  it('style_transfer 缺字段时默认直发（skipUnderstand）', () => {
    const normalized = normalizeCapabilityPreset(
      makeBasePreset({ id: 'style_transfer', label: '转风格' }),
      0
    );
    expect(normalized.skipUnderstand).toBe(true);
  });

  it('style_transfer 显式 skipUnderstand:false 时保留理解步', () => {
    const normalized = normalizeCapabilityPreset(
      makeBasePreset({ id: 'style_transfer', label: '转风格', skipUnderstand: false }),
      0
    );
    expect(normalized.skipUnderstand).toBe(false);
  });

  it('白模等有 instruction 的图生图预设缺字段时默认直发', () => {
    const normalized = normalizeCapabilityPreset(
      makeBasePreset({
        id: '842d3d6e19',
        label: '白模',
        category: 'image_to_image',
        engine: 'gen_image',
        instruction: '将图片转成传统3D游戏影视流程中的白模效果图，灰色背景。',
      }),
      0
    );
    expect(normalized.skipUnderstand).toBe(true);
  });

  it('图生图显式 skipUnderstand:false 时仍走理解步', () => {
    const normalized = normalizeCapabilityPreset(
      makeBasePreset({
        id: '842d3d6e19',
        label: '白模',
        category: 'image_to_image',
        engine: 'gen_image',
        instruction: '白模提示词',
        skipUnderstand: false,
      }),
      0
    );
    expect(normalized.skipUnderstand).toBe(false);
  });
});
