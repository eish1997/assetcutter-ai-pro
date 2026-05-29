import { describe, expect, it } from 'vitest';
import { computeStoryboardMosaicGrid } from '../services/storyboardFrameStripMerge';

describe('storyboardFrameStripMerge', () => {
  it('computes mosaic grid layout', () => {
    expect(computeStoryboardMosaicGrid(1)).toEqual({ cols: 1, rows: 1 });
    expect(computeStoryboardMosaicGrid(2)).toEqual({ cols: 2, rows: 1 });
    expect(computeStoryboardMosaicGrid(3)).toEqual({ cols: 2, rows: 2 });
    expect(computeStoryboardMosaicGrid(4)).toEqual({ cols: 2, rows: 2 });
    expect(computeStoryboardMosaicGrid(5)).toEqual({ cols: 3, rows: 2 });
    expect(computeStoryboardMosaicGrid(6)).toEqual({ cols: 3, rows: 2 });
    expect(computeStoryboardMosaicGrid(9)).toEqual({ cols: 3, rows: 3 });
  });
});
