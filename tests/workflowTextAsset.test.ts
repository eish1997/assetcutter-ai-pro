import { describe, expect, it } from 'vitest';

import type { WorkflowAsset } from '../types';
import { workflowAssetToInputText } from '../services/workflowTextAsset';

function makeTextAsset(partial?: Partial<WorkflowAsset>): WorkflowAsset {
  return {
    id: 'text-1',
    assetKind: 'text',
    textTitle: '标题',
    textBody: '原始正文',
    original: '',
    displayKey: 'original',
    results: {},
    resultOrder: [],
    archived: false,
    hiddenInGrid: false,
    createdAt: Date.now(),
    ...partial,
  };
}

describe('workflowAssetToInputText', () => {
  it('当 displayKey 指向扩写版本时，使用 textResults 的当前版本正文', () => {
    const asset = makeTextAsset({
      displayKey: 'expand_v2',
      textResults: {
        expand_v2: '扩写后的正文',
      },
    });
    expect(workflowAssetToInputText(asset)).toBe('标题\n\n扩写后的正文');
  });

  it('当 displayKey 版本缺失时，回退到原始 textBody', () => {
    const asset = makeTextAsset({
      displayKey: 'missing_version',
      textResults: {},
    });
    expect(workflowAssetToInputText(asset)).toBe('标题\n\n原始正文');
  });
});
