import { describe, expect, it } from 'vitest';
import {
  storyboardFrameCompanionResultKey,
  storyboardRowNeedsCompanionFrameHydrate,
} from '../services/storyboardFrameCompanion';
import type { StoryboardTableRow } from '../types';

describe('storyboardFrameCompanion', () => {
  it('builds stable companion result key', () => {
    expect(storyboardFrameCompanionResultKey('row-1')).toBe('storyboard-frame-row-1');
  });

  it('detects rows needing hydrate', () => {
    const row: StoryboardTableRow = {
      id: 'r1',
      index: 0,
      shotText: '',
      shotFields: {},
      frameImageCompanionKey: 'ck-1',
    };
    expect(storyboardRowNeedsCompanionFrameHydrate(row)).toBe(true);
    expect(storyboardRowNeedsCompanionFrameHydrate({ ...row, frameImage: 'blob:x' })).toBe(false);
    expect(storyboardRowNeedsCompanionFrameHydrate({ ...row, frameImage: 'data:image/png;base64,abc' })).toBe(
      false
    );
  });
});
