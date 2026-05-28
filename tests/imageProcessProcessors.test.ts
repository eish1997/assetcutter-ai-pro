import { describe, expect, it } from 'vitest';

import type { CustomAppModule } from '../types';
import { normalizeCapabilityPreset } from '../services/capabilityPresetStore';
import {
  applyImageProcessorDraftToPreset,
  normalizeProcessorParams,
  readCutImageParams,
  resolveImageProcessorId,
  syncImageProcessProcessorFields,
} from '../services/capabilityProcessors/imageProcessProcessors';

describe('imageProcessProcessors', () => {
  it('resolveImageProcessorId：迁移顶层 cutMode 推断 cut_image', () => {
    const preset = {
      id: 'x1',
      label: '切',
      category: 'image_process',
      cutMode: 'auto',
      engine: 'builtin',
      instruction: '',
    } as CustomAppModule & { cutMode: 'auto' };
    expect(resolveImageProcessorId(preset)).toBe('cut_image');
  });

  it('normalizeProcessorParams：cut_image uniform 行列', () => {
    const params = normalizeProcessorParams('cut_image', {
      cutMode: 'uniform',
      uniformRows: 99,
      uniformCols: 0,
      cutOverflowPx: 999,
    });
    expect(params.cutMode).toBe('uniform');
    expect(params.uniformRows).toBe(10);
    expect(params.uniformCols).toBe(1);
    expect(params.cutOverflowPx).toBe(512);
  });

  it('applyImageProcessorDraftToPreset：remove_bg 写入 legacy 字段', () => {
    const base: CustomAppModule = {
      id: 'rb1',
      label: '抠图',
      category: 'image_process',
      instruction: '',
      enabled: true,
      order: 0,
    };
    const out = applyImageProcessorDraftToPreset(base, 'remove_bg', {
      model: 'u2net',
      alphaMatting: true,
    });
    expect(out.processor).toBe('remove_bg');
    expect(out.companionRembg).toBe(true);
    expect(out.companionRembgModel).toBe('u2net');
    expect(out.companionRembgAlphaMatting).toBe(true);
  });

  it('syncImageProcessProcessorFields：非 image_process 时清除 legacy 字段', () => {
    const normalized = normalizeCapabilityPreset(
      {
        id: 'was-process',
        label: '旧处理',
        category: 'text_to_text',
        engine: 'gen_text',
        instruction: 'translate',
        companionRembg: true,
        cutMode: 'auto',
        processor: 'remove_bg',
        enabled: true,
        order: 0,
      },
      0
    );
    expect(normalized.category).toBe('text_to_text');
    expect(normalized.engine).toBe('gen_text');
    expect(normalized.processor).toBeUndefined();
    expect(normalized.companionRembg).toBeUndefined();
    expect((normalized as { cutMode?: string }).cutMode).toBeUndefined();
  });

  it('syncImageProcessProcessorFields：normalize 后仅保留 params', () => {
    const normalized = normalizeCapabilityPreset(
      {
        id: 'cut_image',
        label: '切割图片',
        category: 'image_process',
        engine: 'builtin',
        cutMode: 'vision',
        cutOverflowPx: 12,
        instruction: '',
        enabled: true,
        order: 0,
      } as CustomAppModule & { cutMode: 'vision'; cutOverflowPx: number },
      0
    );
    expect(normalized.processor).toBe('cut_image');
    expect(normalized.params?.cutMode).toBe('vision');
    expect(normalized.params?.cutOverflowPx).toBe(12);
    expect((normalized as { cutMode?: string }).cutMode).toBeUndefined();
    expect(readCutImageParams(normalized).cutOverflowPx).toBe(12);
  });
});
