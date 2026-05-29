import { describe, expect, it } from 'vitest';
import type { StoryboardParseFieldDef, StoryboardTableRow } from '../types';
import {
  computeStoryboardInputCoverage,
  storyboardInputPreviewFieldLines,
} from '../services/storyboardTableInput';

const catalog: StoryboardParseFieldDef[] = [
  { id: 'f_visual', label: '画面', order: 0, redrawInclude: true, kind: 'text' },
  { id: 'f_dialogue', label: '对白', order: 1, redrawInclude: false, kind: 'text' },
];

const row = (partial: Partial<StoryboardTableRow>): StoryboardTableRow => ({
  id: partial.id || 'r1',
  index: partial.index ?? 0,
  shotFields: partial.shotFields ?? {},
  shotText: partial.shotText ?? '',
  ...partial,
});

describe('storyboardTableInput', () => {
  it('computes input coverage', () => {
    const rows = [
      row({ id: 'a', shotRaw: '剧本', shotFields: { f_visual: '雪夜' } }),
      row({ id: 'b', shotRaw: '', shotFields: {} }),
    ];
    expect(computeStoryboardInputCoverage(rows, catalog)).toEqual({
      total: 2,
      withInput: 1,
      parsed: 1,
      withImage: 0,
    });
  });

  it('lists preview field lines in catalog order', () => {
    const lines = storyboardInputPreviewFieldLines(
      row({ shotFields: { f_dialogue: '台词', f_visual: '画面' } }),
      catalog,
      2
    );
    expect(lines).toEqual([
      { label: '画面', value: '画面' },
      { label: '对白', value: '台词' },
    ]);
  });
});
