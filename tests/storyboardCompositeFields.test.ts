import { describe, expect, it } from 'vitest';
import type { StoryboardTableRow } from '../types';
import { storyboardShotCompositeFieldItems } from '../services/storyboardCompositeFields';

describe('storyboardCompositeFields', () => {
  it('collects non-empty catalog fields for a shot', () => {
    const row: StoryboardTableRow = {
      id: 'a',
      index: 0,
      shotFields: { f_visual: '雪夜', f_dialogue: '' },
      shotText: '',
    };
    const items = storyboardShotCompositeFieldItems(row, [
      { id: 'f_visual', label: '画面', order: 0, redrawInclude: true, kind: 'text' },
      { id: 'f_dialogue', label: '对白', order: 1, redrawInclude: false, kind: 'text' },
    ]);
    expect(items).toEqual([{ id: 'f_visual', label: '画面', value: '雪夜' }]);
  });
});
