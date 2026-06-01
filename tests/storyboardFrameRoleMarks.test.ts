import { describe, expect, it } from 'vitest';
import {
  appendStoryboardFrameRoleMark,
  computeStoryboardFrameRoleMarkPosition,
  normalizeStoryboardFrameRoleMarks,
} from '../services/storyboardFrameRoleMarks';

describe('storyboardFrameRoleMarks', () => {
  it('computes normalized position from client coordinates', () => {
    const rect = { left: 100, top: 50, width: 200, height: 100 } as DOMRect;
    expect(computeStoryboardFrameRoleMarkPosition(150, 100, rect)).toEqual({ x: 0.25, y: 0.5 });
  });

  it('appends mark with clamped coordinates', () => {
    const next = appendStoryboardFrameRoleMark([], {
      name: '张三',
      x: 1.2,
      y: -0.1,
      roleAssetId: 'role-1',
    });
    expect(next).toHaveLength(1);
    expect(next[0]?.name).toBe('张三');
    expect(next[0]?.x).toBe(1);
    expect(next[0]?.y).toBe(0);
    expect(next[0]?.roleAssetId).toBe('role-1');
  });

  it('drops empty names when normalizing', () => {
    expect(
      normalizeStoryboardFrameRoleMarks([{ id: 'a', name: '  ', x: 0.5, y: 0.5 }])
    ).toEqual([]);
  });
});
