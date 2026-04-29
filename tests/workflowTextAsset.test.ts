import { describe, expect, it } from 'vitest';

import type { WorkflowAsset } from '../types';
import {
  buildComposerTextAssetThumbDataUrl,
  workflowAssetAllowedForCapabilityDrop,
  workflowAssetToInputText,
} from '../services/workflowTextAsset';
import type { CustomAppModule } from '../types';

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

describe('buildComposerTextAssetThumbDataUrl', () => {
  it('返回 data URL 且正文过长时在 SVG 中带省略', () => {
    const long = 'a'.repeat(200);
    const url = buildComposerTextAssetThumbDataUrl('短标题', long);
    expect(url.startsWith('data:image/svg+xml')).toBe(true);
    const decoded = decodeURIComponent(url.slice(url.indexOf(',') + 1));
    expect(decoded).toContain('短标题');
    expect(decoded).toContain('…');
  });

  it('对 XML 特殊字符转义', () => {
    const url = buildComposerTextAssetThumbDataUrl('a<b', 'c&d');
    const decoded = decodeURIComponent(url.slice(url.indexOf(',') + 1));
    expect(decoded).toContain('a&lt;b');
    expect(decoded).toContain('c&amp;d');
  });
});

describe('workflowAssetAllowedForCapabilityDrop', () => {
  const hostBundlePreset: CustomAppModule = {
    id: 'hb',
    label: '宿主包',
    category: 'image_to_image',
    engine: 'builtin',
    instruction: '',
    companionHostBundle: { dirName: 'sample-plugin' },
  };

  it('宿主包预设允许文字卡拖入', () => {
    const textAsset = makeTextAsset();
    expect(workflowAssetAllowedForCapabilityDrop(textAsset, hostBundlePreset)).toBe(true);
  });

  it('宿主包预设允许图片卡拖入', () => {
    const imageAsset: WorkflowAsset = {
      id: 'img-1',
      assetKind: 'image',
      original: 'data:image/png;base64,AAA',
      displayKey: 'original',
      results: {},
      resultOrder: [],
      archived: false,
      hiddenInGrid: false,
      createdAt: Date.now(),
    };
    expect(workflowAssetAllowedForCapabilityDrop(imageAsset, hostBundlePreset)).toBe(true);
  });
});
