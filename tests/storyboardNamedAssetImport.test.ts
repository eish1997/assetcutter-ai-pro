import { describe, expect, it } from 'vitest';
import {
  planStoryboardNamedAssetImportAssignments,
  resolveStoryboardNamedAssetImportStartIndex,
} from '../services/storyboardNamedAssetImport';

describe('storyboardNamedAssetImport', () => {
  const assets = [
    { id: 'a1', image: 'x' },
    { id: 'a2' },
    { id: 'a3' },
    { id: 'a4' },
  ];

  it('starts from first empty slot when no start id', () => {
    expect(resolveStoryboardNamedAssetImportStartIndex(assets, null)).toBe(1);
  });

  it('assigns sequentially skipping filled slots', () => {
    const { assignments, unusedFiles } = planStoryboardNamedAssetImportAssignments(assets, null, 3);
    expect(assignments.map((a) => a.assetId)).toEqual(['a2', 'a3', 'a4']);
    expect(unusedFiles).toBe(0);
  });

  it('overwrites when dropped on a specific asset', () => {
    const { assignments } = planStoryboardNamedAssetImportAssignments(assets, 'a1', 2, {
      overwriteStart: true,
    });
    expect(assignments.map((a) => a.assetId)).toEqual(['a1', 'a2']);
  });
});
