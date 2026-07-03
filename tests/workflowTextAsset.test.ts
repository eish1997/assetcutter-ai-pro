import { describe, expect, it } from 'vitest';

import type { WorkflowAsset } from '../types';
import {
  buildComposerTextAssetThumbDataUrl,
  workflowAssetAllowedForCapabilityDrop,
  workflowAssetCurrentDisplayIsTextChannel,
  workflowAssetLightboxRasterEligible,
  workflowAssetToInputText,
  workflowVersionTextSnippet,
  workflowVersionTextThumbLines,
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

describe('workflowAssetCurrentDisplayIsTextChannel', () => {
  it('original 显示为文本通道', () => {
    expect(workflowAssetCurrentDisplayIsTextChannel(makeTextAsset())).toBe(true);
  });

  it('仅有文本结果版本为文本通道', () => {
    expect(
      workflowAssetCurrentDisplayIsTextChannel(
        makeTextAsset({
          displayKey: 'expand_v2',
          textResults: { expand_v2: '扩写' },
        })
      )
    ).toBe(true);
  });

  it('当前版本为 results 中的图时不是文本通道', () => {
    expect(
      workflowAssetCurrentDisplayIsTextChannel(
        makeTextAsset({
          displayKey: 'gen_v1',
          results: { gen_v1: 'data:image/png;base64,AAA' },
        })
      )
    ).toBe(false);
  });
});

describe('workflowAssetLightboxRasterEligible', () => {
  it('文字 original 通道不可走位图 chrome', () => {
    expect(workflowAssetLightboxRasterEligible(makeTextAsset(), '')).toBe(false);
  });

  it('文字资产 results 中的图版本可走位图 chrome', () => {
    expect(
      workflowAssetLightboxRasterEligible(
        makeTextAsset({
          displayKey: 'gen_v1',
          results: { gen_v1: 'data:image/png;base64,AAA' },
        }),
        'data:image/png;base64,AAA'
      )
    ).toBe(true);
  });

  it('普通图片资产有位图即可', () => {
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
    expect(workflowAssetLightboxRasterEligible(imageAsset, 'data:image/png;base64,AAA')).toBe(true);
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

describe('workflowVersionTextThumbLines', () => {
  it('两行各三字，超出第三行省略', () => {
    const asset = makeTextAsset({ textBody: '这是一段很长的正文内容' });
    expect(workflowVersionTextThumbLines(asset, 'original')).toEqual({
      line1: '这是一',
      line2: '段很长',
      showEllipsis: true,
      fullText: '这是一段很长的正文内容',
    });
  });

  it('不足六字不显示第三行', () => {
    const asset = makeTextAsset({ textBody: '你好世界' });
    expect(workflowVersionTextThumbLines(asset, 'original')).toEqual({
      line1: '你好世',
      line2: '界',
      showEllipsis: false,
      fullText: '你好世界',
    });
  });
});

describe('workflowVersionTextSnippet', () => {
  it('原文步骤取正文前几字', () => {
    const asset = makeTextAsset({ textBody: '这是一段很长的正文内容用于测试截断' });
    expect(workflowVersionTextSnippet(asset, 'original')).toBe('这是一段很长…');
  });

  it('文生文结果步骤取 textResults', () => {
    const asset = makeTextAsset({
      displayKey: 'text_to_text:abc',
      textResults: { 'text_to_text:abc': '扩写后的新段落内容' },
    });
    expect(workflowVersionTextSnippet(asset, 'text_to_text:abc')).toBe('扩写后的新段…');
  });

  it('有位图结果的步骤不返回文本摘要', () => {
    const asset = makeTextAsset({
      displayKey: 'text_to_image:abc',
      results: { 'text_to_image:abc': 'data:image/png;base64,AAA' },
    });
    expect(workflowVersionTextSnippet(asset, 'text_to_image:abc')).toBe('');
  });
});

describe('workflowAssetAllowedForCapabilityDrop', () => {
  const hostBundlePreset: CustomAppModule = {
    id: 'hb',
    label: '宿主包',
    category: 'image_process',
    processor: 'host_bundle',
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

  const genVideoPreset: CustomAppModule = {
    id: 'gv',
    label: '生视频',
    category: 'generate_video',
    instruction: '',
  };

  it('生视频预设允许仅有正文的文字卡', () => {
    expect(workflowAssetAllowedForCapabilityDrop(makeTextAsset(), genVideoPreset)).toBe(true);
  });

  it('生视频预设允许仅有图片的图片卡', () => {
    const imageAsset: WorkflowAsset = {
      id: 'img-2',
      assetKind: 'image',
      original: 'data:image/png;base64,AAA',
      displayKey: 'original',
      results: {},
      resultOrder: [],
      archived: false,
      hiddenInGrid: false,
      createdAt: Date.now(),
    };
    expect(workflowAssetAllowedForCapabilityDrop(imageAsset, genVideoPreset)).toBe(true);
  });

  it('生视频预设拒绝无图无文的空壳资产', () => {
    const empty: WorkflowAsset = {
      id: 'empty-1',
      assetKind: 'image',
      original: '',
      displayKey: 'original',
      results: {},
      resultOrder: [],
      archived: false,
      hiddenInGrid: false,
      createdAt: Date.now(),
    };
    expect(workflowAssetAllowedForCapabilityDrop(empty, genVideoPreset)).toBe(false);
  });
});
