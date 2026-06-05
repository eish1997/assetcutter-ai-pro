import { describe, expect, it } from 'vitest';
import {
  clampStoryboardFrameCropRect,
  isNearlyFullCropNorm,
  storyboardFrameCropNormFromDraft,
  storyboardFrameCropNormFromRect,
  storyboardFrameCropRectFromNorm,
} from '../components/storyboard/StoryboardFrameCropModal';

describe('storyboardFrameCropNormFromDraft', () => {
  it('converts draft rect to 0-1 norm crop', () => {
    expect(storyboardFrameCropNormFromDraft({ x1: 100, y1: 200, x2: 600, y2: 800 })).toEqual({
      x: 0.1,
      y: 0.2,
      w: 0.5,
      h: 0.6,
    });
  });
});

describe('isNearlyFullCropNorm', () => {
  it('detects full-frame crop', () => {
    expect(isNearlyFullCropNorm({ x: 0, y: 0, w: 1, h: 1 })).toBe(true);
    expect(isNearlyFullCropNorm({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 })).toBe(false);
  });
});

describe('storyboardFrameCropRect helpers', () => {
  it('round-trips norm through rect', () => {
    const norm = { x: 0.12, y: 0.25, w: 0.4, h: 0.3 };
    expect(storyboardFrameCropNormFromRect(storyboardFrameCropRectFromNorm(norm))).toEqual(norm);
  });

  it('enforces minimum crop size when clamping', () => {
    const rect = clampStoryboardFrameCropRect({ xmin: 10, ymin: 10, xmax: 12, ymax: 12 });
    expect(rect.xmax - rect.xmin).toBeGreaterThanOrEqual(8);
    expect(rect.ymax - rect.ymin).toBeGreaterThanOrEqual(8);
  });
});
