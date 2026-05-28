import { describe, expect, it } from 'vitest';

import type { CustomAppModule } from '../types';
import { readCutImageParams } from '../services/capabilityProcessors/imageProcessProcessors';
import { detectCutImageBoxes, FULL_IMAGE_BOX } from '../services/cutImageExecution';

describe('cutImageExecution', () => {
  it('readCutImageParams：从 params 读取切割配置', () => {
    const preset: CustomAppModule = {
      id: 'cut_image',
      label: '切割',
      category: 'image_process',
      processor: 'cut_image',
      engine: 'builtin',
      instruction: '',
      params: { cutMode: 'uniform', uniformRows: 3, uniformCols: 2, cutOverflowPx: 8 },
    };
    expect(readCutImageParams(preset)).toEqual({
      cutMode: 'uniform',
      uniformRows: 3,
      uniformCols: 2,
      cutOverflowPx: 8,
    });
  });

  it('detectCutImageBoxes：无效输入时回退整图并返回 warn', async () => {
    const preset: CustomAppModule = {
      id: 'cut_image',
      label: '切割',
      category: 'image_process',
      processor: 'cut_image',
      engine: 'builtin',
      instruction: '',
      params: { cutMode: 'uniform', uniformRows: 2, uniformCols: 2 },
    };
    const { boxes, warn } = await detectCutImageBoxes('not-a-valid-image-data-url', preset, {
      visionTextModel: 'test-model',
      timeoutMs: 5000,
    });
    expect(boxes).toEqual([FULL_IMAGE_BOX]);
    expect(warn).toMatch(/均匀分割失败/);
  });
});
