import { describe, expect, it } from 'vitest';
import type { StoryboardTableRow } from '../types';
import {
  appendStoryboardFrameHistory,
  normalizeStoryboardFrameHistory,
  restoreStoryboardRowFrameVersion,
  storyboardFrameRefsEqual,
  trimStoryboardFrameHistory,
} from '../services/storyboardFrameHistory';

const row = (partial: Partial<StoryboardTableRow>): StoryboardTableRow => ({
  id: partial.id || 'r1',
  index: partial.index ?? 0,
  shotFields: partial.shotFields ?? {},
  shotText: partial.shotText ?? '',
  ...partial,
});

describe('storyboardFrameHistory', () => {
  it('normalizes history entries', () => {
    const items = normalizeStoryboardFrameHistory([
      { id: 'v1', createdAt: 1, source: 'redraw', frameImage: 'data:image/png;base64,abc' },
      { id: '', source: 'redraw', frameImage: 'x' },
      null,
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]?.source).toBe('redraw');
  });

  it('detects equal frame refs', () => {
    expect(
      storyboardFrameRefsEqual(
        { frameImage: 'data:x', frameImageObjectKey: 'k1' },
        { frameImage: 'data:x', frameImageObjectKey: 'k1' }
      )
    ).toBe(true);
    expect(
      storyboardFrameRefsEqual(
        { frameImage: 'data:x' },
        { frameImage: 'data:y' }
      )
    ).toBe(false);
  });

  it('appends inline frame to history without companion', async () => {
    const baseRow = row({
      frameImage: 'data:image/png;base64,old',
    });
    const history = await appendStoryboardFrameHistory(baseRow, 'redraw', {
      assetId: 'a1',
      companionBaseUrl: '',
      companionProjectId: '',
    });
    expect(history).toHaveLength(1);
    expect(history[0]?.source).toBe('redraw');
    expect(history[0]?.frameImage).toContain('data:image');
  });

  it('restores a historical version and archives current', async () => {
    const current = row({
      frameImage: 'data:image/png;base64,current',
      frameImageHistory: [
        {
          id: 'v-old',
          createdAt: 1,
          source: 'upload',
          frameImage: 'data:image/png;base64,old',
        },
      ],
    });
    const patch = await restoreStoryboardRowFrameVersion(current, 'v-old', {
      assetId: 'a1',
      companionBaseUrl: '',
      companionProjectId: '',
    });
    expect(patch?.frameImage).toContain('old');
    expect(patch?.frameImageHistory?.some((item) => item.source === 'restore')).toBe(true);
    expect(patch?.frameImageHistory?.some((item) => item.id === 'v-old')).toBe(false);
  });

  it('trims history to limit', () => {
    const long = Array.from({ length: 20 }, (_, i) => ({
      id: `v${i}`,
      createdAt: i,
      source: 'redraw' as const,
      frameImage: `data:${i}`,
    }));
    expect(trimStoryboardFrameHistory(long)).toHaveLength(12);
  });
});
