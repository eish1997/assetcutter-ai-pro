import { describe, expect, it } from 'vitest';
import { mergeStoryboardTableDocs } from '../services/storyboardTableAsset';
import {
  mergeStoryboardNamedAssets,
  pickStoryboardNamedAssetImageFields,
  storyboardNamedAssetHasImageRef,
} from '../services/storyboardNamedAssetImage';
import { normalizeStoryboardRoleAssets } from '../services/storyboardRoleAssets';
import { normalizeStoryboardSceneAssets } from '../services/storyboardSceneAssets';

describe('storyboardNamedAssetImage', () => {
  it('pickStoryboardNamedAssetImageFields keeps companion and object keys', () => {
    expect(
      pickStoryboardNamedAssetImageFields({
        imageCompanionKey: 'ck',
        imageObjectKey: 'ok',
      })
    ).toEqual({ imageCompanionKey: 'ck', imageObjectKey: 'ok' });
  });

  it('mergeStoryboardNamedAssets unions by id and keeps image refs from both sides', () => {
    const merged = mergeStoryboardNamedAssets(
      [{ id: 'a', name: '张三', imageCompanionKey: 'ck1' }],
      [{ id: 'a', name: '', imageObjectKey: 'ok1' }, { id: 'b', name: '场景A' }],
      normalizeStoryboardRoleAssets
    );
    expect(merged).toEqual([
      { id: 'a', name: '张三', imageCompanionKey: 'ck1', imageObjectKey: 'ok1' },
      { id: 'b', name: '场景A' },
    ]);
  });

  it('storyboardNamedAssetHasImageRef detects all storage slots', () => {
    expect(storyboardNamedAssetHasImageRef({ id: 'x', name: 'n', image: 'data:x' })).toBe(true);
    expect(storyboardNamedAssetHasImageRef({ id: 'x', name: 'n', imageCompanionKey: 'ck' })).toBe(true);
    expect(storyboardNamedAssetHasImageRef({ id: 'x', name: 'n' })).toBe(false);
  });
});

describe('mergeStoryboardTableDocs named assets', () => {
  it('merges role and scene assets without dropping either side', () => {
    const merged = mergeStoryboardTableDocs(
      {
        rows: [{ id: 'r1', index: 0, shotNo: '001', shotFields: {} }],
        roleAssets: [{ id: 'role1', name: '主角', imageCompanionKey: 'ck' }],
      },
      {
        rows: [{ id: 'r1', index: 0, shotNo: '001', shotFields: {} }],
        sceneAssets: [{ id: 'scene1', name: '客厅', image: 'data:image/png;base64,abc' }],
      }
    );
    expect(merged.roleAssets).toEqual([{ id: 'role1', name: '主角', imageCompanionKey: 'ck' }]);
    expect(merged.sceneAssets).toEqual([
      { id: 'scene1', name: '客厅', image: 'data:image/png;base64,abc' },
    ]);
    expect(normalizeStoryboardSceneAssets(merged.sceneAssets)).toEqual(merged.sceneAssets);
  });
});
