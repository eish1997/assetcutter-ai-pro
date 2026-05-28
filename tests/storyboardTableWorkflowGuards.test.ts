import { describe, expect, it } from 'vitest';
import { createEmptyStoryboardTableAsset, isWorkflowStoryboardTableAsset } from '../services/storyboardTableAsset';

describe('storyboard table workflow guards', () => {
  it('storyboard asset is not treated as text asset', () => {
    const a = createEmptyStoryboardTableAsset('sb-1');
    expect(isWorkflowStoryboardTableAsset(a)).toBe(true);
    expect(a.assetKind).toBe('storyboard_table');
    expect(a.isGroup).toBeUndefined();
  });

  it('createGroupFromAssets member filter logic', () => {
    const image = { id: 'img-1', assetKind: 'image' as const };
    const sb = createEmptyStoryboardTableAsset('sb-2');
    const ids = ['img-1', 'sb-2', 'missing'];
    const members = ids.filter((id) => {
      const a =
        id === 'img-1' ? image : id === 'sb-2' ? sb : null;
      return a != null && !isWorkflowStoryboardTableAsset(a);
    });
    expect(members).toEqual(['img-1']);
  });
});
