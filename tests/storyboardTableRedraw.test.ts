import { describe, expect, it } from 'vitest';
import type { CustomAppModule } from '../types';
import {
  buildStoryboardRowPromptText,
  listStoryboardRedrawPresets,
  pickDefaultStoryboardRedrawPresetId,
} from '../services/storyboardTableRedraw';

describe('storyboardTableRedraw', () => {
  const presets: CustomAppModule[] = [
    {
      id: 't2i',
      label: '文生图',
      category: 'text_to_image',
      engine: 'gen_image',
      instruction: 'cinematic',
    },
    {
      id: 'i2i',
      label: '图生图',
      category: 'image_to_image',
      engine: 'gen_image',
      instruction: 'refine',
    },
    { id: 'cut', label: '切图', category: 'image_process', processor: 'cut_image', engine: 'builtin' },
    { id: 'txt', label: '文', category: 'text_to_text', engine: 'builtin' },
  ] as CustomAppModule[];

  it('lists only gen_image text/image presets', () => {
    const list = listStoryboardRedrawPresets(presets);
    expect(list.map((p) => p.id)).toEqual(['t2i', 'i2i']);
  });

  it('pickDefaultStoryboardRedrawPresetId returns first', () => {
    expect(pickDefaultStoryboardRedrawPresetId(presets)).toBe('t2i');
  });

  it('buildStoryboardRowPromptText merges fields', () => {
    const text = buildStoryboardRowPromptText({
      id: '1',
      index: 0,
      shotNo: '03',
      shotText: '主角推门',
      durationSec: 2,
    });
    expect(text).toContain('03');
    expect(text).toContain('主角推门');
    expect(text).not.toContain('关联：');
  });
});
