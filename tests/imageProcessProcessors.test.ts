import { describe, expect, it } from 'vitest';

import type { CustomAppModule } from '../types';
import { normalizeCapabilityPreset } from '../services/capabilityPresetStore';
import {
  applyImageProcessorDraftToPreset,
  normalizeProcessorParams,
  resolveImageProcessorId,
  syncImageProcessProcessorFields,
} from '../services/capabilityProcessors/imageProcessProcessors';

describe('imageProcessProcessors', () => {
  it('resolveImageProcessorId：legacy cut_image 字段', () => {
    const preset: CustomAppModule = {
      id: 'x1',
      label: '切',
      category: 'image_process',
      cutMode: 'auto',
      engine: 'builtin',
      instruction: '',
    };
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
    expect(normalized.cutMode).toBeUndefined();
  });

  it('syncImageProcessProcessorFields：normalize 后写入 processor/params', () => {
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
      },
      0
    );
    expect(normalized.processor).toBe('cut_image');
    expect(normalized.params?.cutMode).toBe('vision');
    expect(normalized.params?.cutOverflowPx).toBe(12);
    expect(syncImageProcessProcessorFields(normalized).cutMode).toBe('vision');
  });
});
