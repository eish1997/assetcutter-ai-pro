import { describe, expect, it } from 'vitest';

import type { CustomAppModule } from '../types';
import { getCapabilityEngine, isImageProcessPreset } from '../services/capabilityExecutor';
import { resolveImageProcessorId } from '../services/capabilityProcessors/imageProcessProcessors';

describe('capability image_process guards', () => {
  it('图生图预设带 stale companionHostBundle 时不视为图像处理', () => {
    const preset: CustomAppModule = {
      id: 'style_transfer',
      label: '转风格',
      category: 'image_to_image',
      engine: 'gen_image',
      instruction: 'style',
      companionHostBundle: { dirName: 'stale-bundle' },
    };
    expect(isImageProcessPreset(preset)).toBe(false);
    expect(getCapabilityEngine(preset)).toBe('gen_image');
    expect(resolveImageProcessorId(preset)).toBe('host_bundle');
  });

  it('image_process 预设走 builtin 引擎', () => {
    const preset: CustomAppModule = {
      id: 'rb',
      label: '抠图',
      category: 'image_process',
      processor: 'remove_bg',
      engine: 'builtin',
      instruction: '',
    };
    expect(isImageProcessPreset(preset)).toBe(true);
    expect(getCapabilityEngine(preset)).toBe('builtin');
    expect(resolveImageProcessorId(preset)).toBe('remove_bg');
  });
});
