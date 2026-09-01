import { describe, expect, it } from 'vitest';
import { diffDocumentAssets, documentAssetsKey, patchesFromAssets, toDocumentAssetPatch } from '../services/workspaceDocumentAssets';

describe('workspace document assets', () => {
  it('projects companion keys and never keeps inline binaries', () => {
    const patch = toDocumentAssetPatch({
      id: 'card-1',
      assetKind: 'image',
      displayKey: 'original',
      originalCompanionKey: 'image-full-original-abcd1234',
      resultsCompanionKeys: { gen_1: 'image-full-gen-abcd1234' },
      resultOrder: ['gen_1'],
    });
    expect(patch).toMatchObject({
      id: 'card-1',
      originalCompanionKey: 'image-full-original-abcd1234',
      resultsCompanionKeys: { gen_1: 'image-full-gen-abcd1234' },
    });
    expect(JSON.stringify(patch)).not.toContain('data:image');
  });

  it('diffs upserts and removals by document fields', () => {
    const prev = patchesFromAssets([{ id: 'a', textBody: 'old' }, { id: 'b', textBody: 'keep' }]);
    const next = patchesFromAssets([{ id: 'b', textBody: 'keep' }, { id: 'c', textBody: 'new' }]);
    const diff = diffDocumentAssets(prev, next);
    expect(diff.removedIds).toEqual(['a']);
    expect(diff.upserts.map((p) => p.id)).toEqual(['c']);
    expect(documentAssetsKey(next)).not.toBe(documentAssetsKey(prev));
  });
});
