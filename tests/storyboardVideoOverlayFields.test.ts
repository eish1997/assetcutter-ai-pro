import { describe, expect, it } from 'vitest';
import type { StoryboardParseFieldDef } from '../types';
import { buildStoryboardVideoOverlayLines } from '../services/storyboardVideoOverlayFields';

const catalog: StoryboardParseFieldDef[] = [
  { id: 'f_visual', label: '画面', order: 0, redrawInclude: true, kind: 'text' },
  { id: 'f_dialogue', label: '对白', order: 1, redrawInclude: false, kind: 'text' },
];

describe('storyboardVideoOverlayFields', () => {
  it('builds overlay lines for all catalog fields in order, skipping empty values', () => {
    const lines = buildStoryboardVideoOverlayLines(
      { f_visual: '雪夜', f_dialogue: '' },
      catalog
    );
    expect(lines).toEqual([{ fieldId: 'f_visual', label: '画面', value: '雪夜' }]);
  });

  it('includes every non-empty field from catalog', () => {
    const lines = buildStoryboardVideoOverlayLines(
      { f_visual: '雪夜', f_dialogue: '台词' },
      catalog
    );
    expect(lines).toEqual([
      { fieldId: 'f_visual', label: '画面', value: '雪夜' },
      { fieldId: 'f_dialogue', label: '对白', value: '台词' },
    ]);
  });
});
