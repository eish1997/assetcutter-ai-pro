import { describe, expect, it } from 'vitest';
import type { CustomAppModule } from '../types';
import {
  buildStoryboardRowPromptText,
  listStoryboardFeedbackRedrawRows,
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

  const catalog = [
    { id: 'f_visual', label: '画面', order: 0, redrawInclude: true, kind: 'text' as const },
    { id: 'f_dialogue', label: '对白', order: 1, redrawInclude: false, kind: 'text' as const },
  ];

  it('lists only gen_image text/image presets', () => {
    const list = listStoryboardRedrawPresets(presets);
    expect(list.map((p) => p.id)).toEqual(['t2i', 'i2i']);
  });

  it('pickDefaultStoryboardRedrawPresetId returns first', () => {
    expect(pickDefaultStoryboardRedrawPresetId(presets)).toBe('t2i');
  });

  it('buildStoryboardRowPromptText merges structured fields', () => {
    const text = buildStoryboardRowPromptText(
      {
        id: '1',
        index: 0,
        shotNo: '03',
        shotFields: { f_visual: '主角推门', f_dialogue: '你好' },
        shotText: '',
        durationSec: 2,
      },
      catalog
    );
    expect(text).toContain('03');
    expect(text).toContain('主角推门');
    expect(text).not.toContain('你好');
  });

  it('buildStoryboardRowPromptText appends edit feedback', () => {
    const text = buildStoryboardRowPromptText(
      {
        id: '1',
        index: 0,
        shotNo: '03',
        shotFields: { f_visual: '主角推门', f_dialogue: '你好' },
        shotText: '',
        durationSec: 2,
        editFeedback: '门把手再大一点',
      },
      catalog
    );
    expect(text).toContain('【修改反馈】门把手再大一点');
  });

  it('listStoryboardFeedbackRedrawRows skips locked and empty feedback', () => {
    const rows = [
      { id: 'a', index: 0, shotFields: {}, shotText: '', editFeedback: '改构图', locked: false },
      { id: 'b', index: 1, shotFields: {}, shotText: '', editFeedback: '  ', locked: false },
      { id: 'c', index: 2, shotFields: {}, shotText: '', editFeedback: '保留', locked: true },
    ];
    expect(listStoryboardFeedbackRedrawRows(rows).map((r) => r.id)).toEqual(['a']);
  });
});
