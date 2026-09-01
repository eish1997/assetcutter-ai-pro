import { describe, expect, it } from 'vitest';
import { mergeAssetUpsert, removeAssetById } from '../services/workspaceAssetUpsertMerge';

describe('mergeAssetUpsert', () => {
  it('inserts a new card and patches an existing one', () => {
    const inserted = mergeAssetUpsert([], { id: 'a1', textBody: 'hello' });
    expect(inserted).toEqual([{ id: 'a1', textBody: 'hello' }]);
    const patched = mergeAssetUpsert(inserted, { id: 'a1', displayKey: 'append_1', textResults: { append_1: 'more' } });
    expect(patched[0]).toMatchObject({ id: 'a1', textBody: 'hello', displayKey: 'append_1' });
  });

  it('removeAssetById drops a card and leaves others', () => {
    const list = [
      { id: 'a1', textBody: 'keep' },
      { id: 'a2', textBody: 'gone' },
    ];
    expect(removeAssetById(list, 'a2')).toEqual([{ id: 'a1', textBody: 'keep' }]);
    expect(removeAssetById(list, 'missing')).toBe(list);
  });
});
