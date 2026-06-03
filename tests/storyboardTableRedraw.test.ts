import { describe, expect, it } from 'vitest';
import type { CustomAppModule, StoryboardTableRow } from '../types';
import {
  buildStoryboardFeedbackRedrawInputText,
  isStoryboardFeedbackRedrawEligible,
  pickStoryboardEditRedrawPreset,
  pickStoryboardFeedbackRedrawPreset,
  pickDefaultStoryboardFeedbackCollagePresetId,
  resolveStoryboardFeedbackCollagePreset,
  STORYBOARD_FEEDBACK_COLLAGE_DEFAULT_PRESET_ID,
  DEFAULT_STORYBOARD_FEEDBACK_COLLAGE_INSTRUCTION,
  getBuiltinStoryboardFeedbackCollagePreset,
  listStoryboardFeedbackCollageRedrawPresets,
  listStoryboardRowsWithEditFeedback,
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

  it('pickStoryboardFeedbackRedrawPreset prefers builtin collage preset', () => {
    const preset = pickStoryboardFeedbackRedrawPreset([
      mockPreset('t2i', 'text_to_image'),
      mockPreset('i2i', 'image_to_image'),
    ]);
    expect(preset?.id).toBe(STORYBOARD_FEEDBACK_COLLAGE_DEFAULT_PRESET_ID);
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

  it('still resolves builtin when user presets lack image_to_image', () => {
    expect(pickStoryboardFeedbackRedrawPreset([mockPreset('t2i', 'text_to_image')])?.id).toBe(
      STORYBOARD_FEEDBACK_COLLAGE_DEFAULT_PRESET_ID
    );
  });

  it('injects builtin collage preset when not stored', () => {
    expect(pickStoryboardFeedbackRedrawPreset(i2iPresets)?.id).toBe(
      STORYBOARD_FEEDBACK_COLLAGE_DEFAULT_PRESET_ID
    );
  });

  it('respects disabled builtin collage preset in capability store', () => {
    const presets = [
      {
        ...mockPreset(STORYBOARD_FEEDBACK_COLLAGE_DEFAULT_PRESET_ID, 'image_to_image'),
        label: '分镜拼图改图',
        enabled: false,
      },
    ];
    const list = listStoryboardFeedbackCollageRedrawPresets(presets);
    expect(list.some((p) => p.id === STORYBOARD_FEEDBACK_COLLAGE_DEFAULT_PRESET_ID)).toBe(false);
    expect(pickStoryboardFeedbackRedrawPreset(presets)).toBeNull();
  });

  it('resolveStoryboardFeedbackCollagePreset respects stored id', () => {
    const presets = [
      mockPreset('storyboard_collage_alt', 'image_to_image'),
      {
        ...mockPreset(STORYBOARD_FEEDBACK_COLLAGE_DEFAULT_PRESET_ID, 'image_to_image'),
        label: '分镜拼图改图',
      },
    ];
    expect(resolveStoryboardFeedbackCollagePreset(presets, 'storyboard_collage_alt')?.id).toBe(
      'storyboard_collage_alt'
    );
    expect(resolveStoryboardFeedbackCollagePreset(presets, 'missing')?.id).toBe(
      STORYBOARD_FEEDBACK_COLLAGE_DEFAULT_PRESET_ID
    );
  });

  it('defaults collage redraw to builtin storyboard_collage_redraw_v1', () => {
    const presets = [
      mockPreset('style_transfer', 'image_to_image'),
      {
        ...mockPreset('storyboard_collage_redraw_v1', 'image_to_image'),
        id: STORYBOARD_FEEDBACK_COLLAGE_DEFAULT_PRESET_ID,
        label: '分镜拼图改图',
      },
    ];
    expect(pickDefaultStoryboardFeedbackCollagePresetId(presets)).toBe(
      STORYBOARD_FEEDBACK_COLLAGE_DEFAULT_PRESET_ID
    );
    expect(resolveStoryboardFeedbackCollagePreset(presets, null)?.id).toBe(
      STORYBOARD_FEEDBACK_COLLAGE_DEFAULT_PRESET_ID
    );
  });

  it('builtin collage preset includes default instruction', () => {
    const preset = getBuiltinStoryboardFeedbackCollagePreset();
    expect(preset.instruction).toBe(DEFAULT_STORYBOARD_FEEDBACK_COLLAGE_INSTRUCTION);
    expect(preset.instruction).toContain('修改反馈');
    expect(preset.instruction).toContain('画风');
  });

  it('lists rows with edit feedback including locked rows', () => {
    const rows = [
      mockRow({ editFeedback: 'a' }),
      mockRow({ locked: true, editFeedback: 'b' }),
      mockRow({ editFeedback: '' }),
    ];
    expect(listStoryboardRowsWithEditFeedback(rows)).toHaveLength(2);
  });
});
