import { describe, expect, it } from 'vitest';
import type { WorkflowAsset } from '../types';
import { resolveWorkflowCanvasCardAspect } from '../components/workflow/workflowCardAspect';

function textAsset(partial?: Partial<WorkflowAsset>): WorkflowAsset {
  return {
    id: 'text-1',
    assetKind: 'text',
    textTitle: '标题',
    textBody: '正文',
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

describe('resolveWorkflowCanvasCardAspect', () => {
  it('文本资产无锁定比例时纯文本步骤用 3/4', () => {
    const asset = textAsset();
    expect(
      resolveWorkflowCanvasCardAspect(asset, {}, { hasTextPayload: true, hasDisplayImage: false })
    ).toBe(3 / 4);
  });

  it('文本资产已锁定比例时切回文本步骤仍用首张图比例', () => {
    const asset = textAsset({ gridCardAspectRatio: 16 / 9 });
    expect(
      resolveWorkflowCanvasCardAspect(asset, {}, { hasTextPayload: true, hasDisplayImage: false })
    ).toBeCloseTo(16 / 9);
  });

  it('文本资产已锁定比例时显示图片步骤也用同一比例', () => {
    const asset = textAsset({
      gridCardAspectRatio: 4 / 3,
      displayKey: 'text_to_image:abc',
      results: { 'text_to_image:abc': 'data:image/png;base64,AAA' },
    });
    expect(
      resolveWorkflowCanvasCardAspect(asset, {}, { hasTextPayload: true, hasDisplayImage: true })
    ).toBeCloseTo(4 / 3);
  });
});
