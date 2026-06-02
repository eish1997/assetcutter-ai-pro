import { describe, expect, it } from 'vitest';
import {
  canPatchStoryboardPassedRow,
  storyboardRowCompositeBodyText,
  storyboardRowIsPassed,
  storyboardRowOutlineSubtitle,
  storyboardRowOutlineTitle,
} from '../components/storyboard/storyboardRowDisplay';

describe('storyboardRowDisplay', () => {
  const catalog = [
    { id: 'f_visual', label: '画面', order: 0, redrawInclude: true, kind: 'text' as const },
    { id: 'f_dialogue', label: '对白', order: 1, redrawInclude: false, kind: 'text' as const },
  ];

  it('storyboardRowOutlineTitle prefers shotNo', () => {
    expect(
      storyboardRowOutlineTitle(
        { id: '1', index: 0, shotText: '', shotFields: {}, shotNo: 'A3' },
        2
      )
    ).toBe('A3');
    expect(
      storyboardRowOutlineTitle({ id: '1', index: 2, shotText: '', shotFields: {} }, 2)
    ).toBe('003');
  });

  it('storyboardRowOutlineSubtitle uses primary visual field', () => {
    expect(
      storyboardRowOutlineSubtitle({ id: '1', index: 0, shotText: '  ', shotFields: {} }, catalog)
    ).toContain('未填写');
    expect(
      storyboardRowOutlineSubtitle(
        {
          id: '1',
          index: 0,
          shotText: '',
          shotFields: { f_visual: '推门\n进屋' },
        },
        catalog
      )
    ).toBe('推门 进屋');
  });

  it('storyboardRowIsPassed reflects locked flag', () => {
    expect(storyboardRowIsPassed({ locked: true })).toBe(true);
    expect(storyboardRowIsPassed({ locked: false })).toBe(false);
    expect(storyboardRowIsPassed({})).toBe(false);
  });

  it('canPatchStoryboardPassedRow only allows locked changes', () => {
    expect(canPatchStoryboardPassedRow({ locked: false })).toBe(true);
    expect(canPatchStoryboardPassedRow({ editFeedback: 'x' })).toBe(false);
    expect(canPatchStoryboardPassedRow({ locked: true, editFeedback: '' })).toBe(false);
  });

  it('storyboardRowCompositeBodyText includes all structured fields', () => {
    const text = storyboardRowCompositeBodyText(
      {
        id: '1',
        index: 0,
        shotText: '',
        shotFields: { f_visual: '雪夜', f_dialogue: '你好' },
      },
      catalog
    );
    expect(text).toContain('【画面】雪夜');
    expect(text).toContain('【对白】你好');
  });
});
