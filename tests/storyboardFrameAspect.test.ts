import { describe, expect, it } from 'vitest';
import { aspectRatioLabelFromPixelSize } from '../services/storyboardFrameAspect';

describe('storyboardFrameAspect', () => {
  it('maps common pixel sizes to aspect labels', () => {
    expect(aspectRatioLabelFromPixelSize(1920, 1080)).toBe('16:9');
    expect(aspectRatioLabelFromPixelSize(1080, 1920)).toBe('9:16');
    expect(aspectRatioLabelFromPixelSize(1024, 1024)).toBe('1:1');
  });
});
