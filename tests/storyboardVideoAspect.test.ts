import { describe, expect, it } from 'vitest';
import {
  fitStoryboardAspectInBox,
  storyboardVideoPaneHeights,
} from '../services/storyboardVideoFit';
import { getStoryboardVideoAspectPreset } from '../services/storyboardVideoAspect';

describe('storyboardVideoFit', () => {
  it('fits landscape inside box without exceeding bounds', () => {
    const { width, height } = fitStoryboardAspectInBox(800, 400, 16, 9);
    expect(width).toBeLessThanOrEqual(800);
    expect(height).toBeLessThanOrEqual(400);
    expect(width / height).toBeCloseTo(16 / 9, 2);
  });

  it('fits portrait inside box', () => {
    const { width, height } = fitStoryboardAspectInBox(400, 600, 9, 16);
    expect(width).toBeLessThanOrEqual(400);
    expect(height).toBeLessThanOrEqual(600);
    expect(width / height).toBeCloseTo(9 / 16, 2);
  });

  it('allocates smaller default timeline pane', () => {
    const { previewHeight, timelineHeight } = storyboardVideoPaneHeights(600, 0.18);
    expect(timelineHeight).toBeLessThan(previewHeight);
    expect(previewHeight + timelineHeight).toBeLessThanOrEqual(600);
  });
});

describe('storyboardVideoAspect', () => {
  it('defaults to 16:9', () => {
    const p = getStoryboardVideoAspectPreset('unknown');
    expect(p.id).toBe('16:9');
  });
});
