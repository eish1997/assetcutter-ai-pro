import { describe, expect, it } from 'vitest';
import {
  appendStoryboardFrameRoleMark,
  computeStoryboardFrameRoleMarkPosition,
  normalizeStoryboardFrameRoleMarks,
  rebindStoryboardFrameRoleMark,
  removeStoryboardFrameRoleMark,
  resolveStoryboardFrameRoleMarkDisplayName,
  resolveStoryboardFrameRoleMarkFontSize,
  setStoryboardFrameRoleMarkCustomName,
  updateStoryboardFrameRoleMark,
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

  it('scales role mark font size with image width without a low cap', () => {
    expect(resolveStoryboardFrameRoleMarkFontSize(200)).toBe(9);
    expect(resolveStoryboardFrameRoleMarkFontSize(960)).toBe(35);
    expect(resolveStoryboardFrameRoleMarkFontSize(3840)).toBe(141);
  });

  it('updates and removes marks', () => {
    const marks = appendStoryboardFrameRoleMark([], {
      name: 'A',
      x: 0.2,
      y: 0.3,
    });
    const id = marks[0]!.id;
    const moved = updateStoryboardFrameRoleMark(marks, id, { x: 0.8, y: 0.1 });
    expect(moved[0]?.x).toBe(0.8);
    expect(moved[0]?.y).toBe(0.1);
    expect(removeStoryboardFrameRoleMark(moved, id)).toEqual([]);
  });

  it('rebinds mark to role asset and resolves display name from asset', () => {
    const marks = appendStoryboardFrameRoleMark([], {
      name: '旧名',
      x: 0.5,
      y: 0.5,
    });
    const id = marks[0]!.id;
    const rebound = rebindStoryboardFrameRoleMark(marks, id, {
      id: 'role-1',
      name: '角色甲',
    });
    expect(rebound[0]?.roleAssetId).toBe('role-1');
    expect(
      resolveStoryboardFrameRoleMarkDisplayName(rebound[0]!, [
        { id: 'role-1', name: '角色甲' },
      ])
    ).toBe('角色甲');
  });

  it('sets custom name and clears role asset binding', () => {
    const marks = appendStoryboardFrameRoleMark([], {
      name: '旧名',
      x: 0.5,
      y: 0.5,
      roleAssetId: 'role-1',
    });
    const id = marks[0]!.id;
    const next = setStoryboardFrameRoleMarkCustomName(marks, id, '自定义');
    expect(next[0]?.name).toBe('自定义');
    expect(next[0]?.roleAssetId).toBeUndefined();
  });
});
