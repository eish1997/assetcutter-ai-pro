import { describe, expect, it } from 'vitest';
import {
  createStoryboardRoleAsset,
  defaultStoryboardRoleAssetName,
  duplicateStoryboardRoleAssets,
  normalizeStoryboardRoleAssets,
} from '../services/storyboardRoleAssets';

describe('storyboardRoleAssets', () => {
  it('creates role asset with default name', () => {
    expect(createStoryboardRoleAsset(undefined, 0).name).toBe('角色1');
    expect(defaultStoryboardRoleAssetName(2)).toBe('角色3');
  });

  it('normalizes invalid entries', () => {
    expect(normalizeStoryboardRoleAssets(null)).toEqual([]);
    expect(normalizeStoryboardRoleAssets([{ id: 'a', name: '张三', image: 'data:x' }])).toEqual([
      { id: 'a', name: '张三', image: 'data:x' },
    ]);
    expect(normalizeStoryboardRoleAssets([{ id: 'b', name: '', image: 'data:z' }])).toEqual([
      { id: 'b', name: '', image: 'data:z' },
    ]);
  });

  it('duplicates with fresh ids', () => {
    const dup = duplicateStoryboardRoleAssets([{ id: 'old', name: '李四', image: 'data:y' }]);
    expect(dup).toHaveLength(1);
    expect(dup[0]?.id).not.toBe('old');
    expect(dup[0]?.name).toBe('李四');
    expect(dup[0]?.image).toBe('data:y');
  });
});
