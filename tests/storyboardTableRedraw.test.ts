import { describe, expect, it } from 'vitest';
import type { CustomAppModule, StoryboardTableRow } from '../types';
import {
  buildStoryboardFeedbackRedrawInputText,
  isStoryboardFeedbackRedrawEligible,
  pickStoryboardEditRedrawPreset,
  pickStoryboardFeedbackRedrawPreset,
} from '../services/storyboardTableRedraw';

function mockPreset(id: string, category: 'text_to_image' | 'image_to_image'): CustomAppModule {
  return {
    id,
    label: id,
    category,
    enabled: true,
    instruction: 'test',
  } as CustomAppModule;
}

function mockRow(overrides: Partial<StoryboardTableRow> = {}): StoryboardTableRow {
  return {
    id: 'row-1',
    index: 0,
    shotNo: '1',
    locked: false,
    fields: {},
    ...overrides,
  } as StoryboardTableRow;
}

describe('pickStoryboardEditRedrawPreset', () => {
  const presets = [mockPreset('t2i', 'text_to_image'), mockPreset('i2i', 'image_to_image')];

  it('picks text_to_image when row has no frame ref', () => {
    const preset = pickStoryboardEditRedrawPreset(presets, mockRow());
    expect(preset?.id).toBe('t2i');
  });

  it('picks image_to_image when row has frame image', () => {
    const preset = pickStoryboardEditRedrawPreset(
      presets,
      mockRow({ frameImage: 'data:image/png;base64,abc' })
    );
    expect(preset?.id).toBe('i2i');
  });

  it('forceTextToImage keeps text_to_image even with frame', () => {
    const preset = pickStoryboardEditRedrawPreset(
      presets,
      mockRow({ frameImage: 'data:image/png;base64,abc' }),
      { forceTextToImage: true }
    );
    expect(preset?.id).toBe('t2i');
  });
});

describe('feedback batch redraw helpers', () => {
  const i2iPresets = [mockPreset('i2i', 'image_to_image')];

  it('pickStoryboardFeedbackRedrawPreset uses image_to_image only', () => {
    const preset = pickStoryboardFeedbackRedrawPreset([
      mockPreset('t2i', 'text_to_image'),
      mockPreset('i2i', 'image_to_image'),
    ]);
    expect(preset?.id).toBe('i2i');
  });

  it('buildStoryboardFeedbackRedrawInputText returns raw feedback only', () => {
    expect(
      buildStoryboardFeedbackRedrawInputText(
        mockRow({ editFeedback: '  把天空改蓝  ' } as StoryboardTableRow)
      )
    ).toBe('把天空改蓝');
  });

  it('isStoryboardFeedbackRedrawEligible requires feedback and frame', () => {
    expect(isStoryboardFeedbackRedrawEligible(mockRow({ editFeedback: '改色' }))).toBe(false);
    expect(
      isStoryboardFeedbackRedrawEligible(
        mockRow({ editFeedback: '改色', frameImage: 'data:image/png;base64,x' })
      )
    ).toBe(true);
    expect(
      isStoryboardFeedbackRedrawEligible(
        mockRow({ locked: true, editFeedback: '改色', frameImage: 'data:image/png;base64,x' })
      )
    ).toBe(false);
  });

  it('returns null when no image_to_image preset', () => {
    expect(pickStoryboardFeedbackRedrawPreset([mockPreset('t2i', 'text_to_image')])).toBeNull();
  });

  it('i2i preset list sanity', () => {
    expect(pickStoryboardFeedbackRedrawPreset(i2iPresets)?.id).toBe('i2i');
  });
});
