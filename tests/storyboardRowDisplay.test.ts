import { describe, expect, it } from 'vitest';
import {
  storyboardRowOutlineSubtitle,
  storyboardRowOutlineTitle,
} from '../components/storyboard/storyboardRowDisplay';

describe('storyboardRowDisplay', () => {
  it('storyboardRowOutlineTitle prefers shotNo', () => {
    expect(
      storyboardRowOutlineTitle({ id: '1', index: 0, shotText: '', shotNo: 'A3' }, 2)
    ).toBe('A3');
    expect(storyboardRowOutlineTitle({ id: '1', index: 2, shotText: '' }, 2)).toBe('03');
  });

  it('storyboardRowOutlineSubtitle falls back when empty', () => {
    expect(storyboardRowOutlineSubtitle({ id: '1', index: 0, shotText: '  ' })).toContain('未填写');
    expect(storyboardRowOutlineSubtitle({ id: '1', index: 0, shotText: '推门\n进屋' })).toBe('推门 进屋');
  });
});
