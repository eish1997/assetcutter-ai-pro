import { describe, expect, it } from 'vitest';
import type { BoundingBox } from '../types';
import {
  feedbackCollageLayoutToBoxes,
  feedbackCollageLayoutToManualAdjustBoxes,
  refineFeedbackCollageCropBox,
} from '../services/storyboardFeedbackCollageSplit';
import { clampStoryboardSheetSplitBox } from '../services/storyboardSheetVisionSplit';

const sampleBox: BoundingBox = {
  id: 'row-1',
  label: '001',
  xmin: 100,
  ymin: 120,
  xmax: 420,
  ymax: 360,
};

describe('storyboardFeedbackCollageSplit', () => {
  it('manual adjust initial boxes match layout without refine shrink', () => {
    const layout = {
      width: 960,
      height: 720,
      cells: [
        {
          rowId: 'row-1',
          shotNo: '001',
          imageBox: sampleBox,
        },
      ],
    };

    const manual = feedbackCollageLayoutToManualAdjustBoxes(layout)[0]!;
    expect(manual.xmin).toBe(sampleBox.xmin);
    expect(manual.ymin).toBe(sampleBox.ymin);
    expect(manual.xmax).toBe(sampleBox.xmax);
    expect(manual.ymax).toBe(sampleBox.ymax);

    const auto = feedbackCollageLayoutToBoxes(layout)[0]!;
    expect(auto.xmin).toBeGreaterThan(sampleBox.xmin);
    expect(auto.ymax).toBeLessThan(sampleBox.ymax);
  });

  it('refineFeedbackCollageCropBox shrinks boxes but clamp preserves manual coords', () => {
    const refined = refineFeedbackCollageCropBox(sampleBox);
    expect(refined.xmin).toBeGreaterThan(sampleBox.xmin);
    expect(refined.ymax).toBeLessThan(sampleBox.ymax);

    const clamped = clampStoryboardSheetSplitBox(sampleBox);
    expect(clamped).toMatchObject({
      xmin: sampleBox.xmin,
      ymin: sampleBox.ymin,
      xmax: sampleBox.xmax,
      ymax: sampleBox.ymax,
    });
  });
});
