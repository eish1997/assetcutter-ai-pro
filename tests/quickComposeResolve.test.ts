import { describe, expect, it } from 'vitest';

import type { WorkflowAsset } from '../types';
import {
  buildQuickComposePromptOverride,
  buildQuickComposeTaskPromptOverride,
  createQuickComposeMention,
  insertMentionTokenInDraft,
  mergePrimaryAndReferenceImageUrls,
  newQuickComposeMentionSegment,
  newQuickComposeTextSegment,
  orderMentionsByDraft,
  relocateMentionSegment,
  renumberQuickComposeDropSlotLabels,
  renumberQuickComposeMainDropSlotLabels,
  renumberQuickComposeReferenceDropSlotLabels,
  resolveQuickComposeImageQueues,
  resolveQuickComposeReferences,
  splitPrimaryAndReferenceImageUrls,
  stripCurrentViewFromQuickComposeSegments,
  stripMentionTokensFromDraft,
  ensureQuickComposeEditableBoundaries,
  workflowAssetMentionLabel,
  QUICK_COMPOSE_CURRENT_VIEW_LABEL,
} from '../services/quickComposeMention';

function imageAsset(id: string, title?: string): WorkflowAsset {
  return {
    id,
    original: `data:image/png;base64,${id}`,
    displayKey: 'original',
    results: {},
    resultOrder: [],
    archived: false,
    hiddenInGrid: false,
    createdAt: 1,
    ...(title ? { textTitle: title } : {}),
  };
}

describe('quickComposeMention', () => {
  it('orders mentions by @ appearance in draft', () => {
    const a = createQuickComposeMention({ kind: 'asset', assetId: 'a1', label: '风格' }, [])!;
    const b = createQuickComposeMention({ kind: 'asset', assetId: 'a2', label: '主体' }, [a])!;
    expect(a.label).toBe('图1');
    expect(b.label).toBe('图2');
    const ordered = orderMentionsByDraft('@图2 保持 @图1 晕染', [a, b]);
    expect(ordered.map((m) => m.label)).toEqual(['图2', '图1']);
  });

  it('assigns numeric labels 图1 图2 on insert', () => {
    const m1 = createQuickComposeMention({ kind: 'asset', assetId: 'a1', label: '任意标题' }, [])!;
    const m2 = createQuickComposeMention({ kind: 'asset', assetId: 'a2', label: '图B' }, [m1])!;
    expect(m1.label).toBe('图1');
    expect(m2.label).toBe('图2');
  });

  it('renumbers image mentions after drag reorder', () => {
    const m1 = createQuickComposeMention({ kind: 'asset', assetId: 'a1', label: 'x' }, [])!;
    const m2 = createQuickComposeMention({ kind: 'asset', assetId: 'a2', label: 'y' }, [m1])!;
    const segs = ensureQuickComposeEditableBoundaries([
      newQuickComposeMentionSegment(m2),
      newQuickComposeTextSegment('中间'),
      newQuickComposeMentionSegment(m1),
    ]);
    expect(segs.filter((s) => s.type === 'mention').map((s) => (s as { mention: { label: string } }).mention.label)).toEqual([
      '图1',
      '图2',
    ]);
  });

  it('resolves asset images and current view', () => {
    const assets = [imageAsset('a1', '图A'), imageAsset('a2', '图B')];
    const cv = createQuickComposeMention({ kind: 'current_view', label: QUICK_COMPOSE_CURRENT_VIEW_LABEL }, [])!;
    const m2 = createQuickComposeMention({ kind: 'asset', assetId: 'a2', label: '图B' }, [cv])!;
    const draft = `@图1 改光影 @图2 构图`;
    const r = resolveQuickComposeReferences({
      draft,
      mentions: [cv, m2],
      assets,
      getAssetDisplayImage: (a) => a.original,
      maxRefs: 10,
      currentViewDataUrl: 'data:image/png;base64,view',
    });
    expect(r.refs).toEqual(['data:image/png;base64,view', 'data:image/png;base64,a2']);
    expect(r.userPrompt).toBe('构图');
    expect(r.referenceContextBlock).toContain('图1');
    expect(r.referenceContextBlock).toContain('说明：改光影');
    expect(r.referenceContextBlock).toContain('图2');
    expect(r.referenceContextBlock).not.toContain('说明：构图');
  });

  it('resolves refs from drop slots without @ mentions', () => {
    const assets = [imageAsset('a1'), imageAsset('a2')];
    const dropSlots = renumberQuickComposeDropSlotLabels([
      { assetId: 'a1', previewSrc: 'data:image/png;base64,a1', label: '图1' },
      { assetId: 'a2', previewSrc: 'data:image/png;base64,a2', label: '图2' },
    ]);
    const r = resolveQuickComposeReferences({
      segments: [newQuickComposeTextSegment('只写正文不@')],
      dropSlots,
      assets,
      getAssetDisplayImage: (a) => a.original,
      maxRefs: 10,
    });
    expect(r.refs).toEqual(['data:image/png;base64,a1', 'data:image/png;base64,a2']);
    expect(r.userPrompt).toBe('只写正文不@');
    expect(r.referenceContextBlock).toContain('图1');
    expect(r.referenceContextBlock).toContain('图2');
  });

  it('does not duplicate trailing user text in prompt merge', () => {
    const assets = [imageAsset('a1'), imageAsset('a2')];
    const m1 = createQuickComposeMention({ kind: 'asset', assetId: 'a1', label: 'x' }, [])!;
    const m2 = createQuickComposeMention({ kind: 'asset', assetId: 'a2', label: 'y' }, [m1])!;
    const tail = '在图1的基础上参考图2调整灯光氛围';
    const segments = ensureQuickComposeEditableBoundaries([
      newQuickComposeMentionSegment(m1),
      newQuickComposeMentionSegment(m2),
      newQuickComposeTextSegment(tail),
    ]);
    const r = resolveQuickComposeReferences({
      segments,
      assets,
      getAssetDisplayImage: (a) => a.original,
      maxRefs: 10,
    });
    expect(r.referenceContextBlock).not.toContain(tail);
    expect(r.userPrompt).toBe(tail);
    const merged = buildQuickComposePromptOverride(r.userPrompt, r.referenceContextBlock);
    expect(merged.split(tail).length - 1).toBe(1);
  });

  it('splitPrimaryAndReferenceImageUrls keeps first as primary', () => {
    const urls = ['data:1', 'data:2', 'data:3'];
    expect(splitPrimaryAndReferenceImageUrls(urls)).toEqual({
      primary: 'data:1',
      references: ['data:2', 'data:3'],
    });
  });

  it('mergePrimaryAndReferenceImageUrls dedupes legacy full list', () => {
    const merged = mergePrimaryAndReferenceImageUrls('data:1', ['data:1', 'data:2']);
    expect(merged).toEqual(['data:1', 'data:2']);
  });

  it('strips @ tokens from user prompt', () => {
    const m = createQuickComposeMention({ kind: 'asset', assetId: 'x', label: '测试图' }, [])!;
    expect(stripMentionTokensFromDraft('@图1 加亮', [m])).toBe('加亮');
  });

  it('dedupes duplicate asset mentions in refs', () => {
    const assets = [imageAsset('a1', '重复')];
    const m1 = createQuickComposeMention({ kind: 'asset', assetId: 'a1', label: '重复' }, [])!;
    const r = resolveQuickComposeReferences({
      draft: '@重复 @重复',
      mentions: [m1],
      assets,
      getAssetDisplayImage: (a) => a.original,
      maxRefs: 10,
    });
    expect(r.refs).toHaveLength(1);
  });

  it('workflowAssetMentionLabel prefers textTitle', () => {
    expect(workflowAssetMentionLabel(imageAsset('id', '我的标题'))).toBe('我的标题');
  });

  it('insertMentionTokenInDraft appends token', () => {
    expect(insertMentionTokenInDraft('hello', '图A')).toBe('hello @图A ');
  });

  it('relocateMention splits text at offset', () => {
    const t1 = newQuickComposeTextSegment('hello');
    const t2 = newQuickComposeTextSegment('world');
    const m = createQuickComposeMention({ kind: 'asset', assetId: 'x', label: '图' }, [])!;
    const next = relocateMentionSegment(
      [t1, newQuickComposeMentionSegment(m), t2],
      m.id,
      { mode: 'text', segmentId: t1.id, offset: 2 }
    );
    expect(next.map((s) => (s.type === 'text' ? s.value : '@'))).toEqual(['he', '@', 'lloworld']);
  });

  it('resolves segments in visual order (text + image + text)', () => {
    const assets = [imageAsset('a1', '图A')];
    const m = createQuickComposeMention({ kind: 'asset', assetId: 'a1', label: '图A' }, [])!;
    const segments = ensureQuickComposeEditableBoundaries([
      newQuickComposeTextSegment('前面'),
      newQuickComposeMentionSegment(m),
      newQuickComposeTextSegment('后面'),
    ]);
    const r = resolveQuickComposeReferences({
      segments,
      assets,
      getAssetDisplayImage: (a) => a.original,
      maxRefs: 10,
    });
    expect(r.refs).toEqual(['data:image/png;base64,a1']);
    expect(r.userPrompt).toBe('前面 后面');
    expect(r.referenceContextBlock).toContain('图1');
    expect(r.referenceContextBlock).toContain('待编辑主图');
  });

  it('stripCurrentViewFromQuickComposeSegments removes current_view only', () => {
    const cv = createQuickComposeMention({ kind: 'current_view', label: QUICK_COMPOSE_CURRENT_VIEW_LABEL }, [])!;
    const asset = createQuickComposeMention({ kind: 'asset', assetId: 'a1', label: '图A' }, [cv])!;
    const segs = ensureQuickComposeEditableBoundaries([
      newQuickComposeMentionSegment(cv),
      newQuickComposeTextSegment('改光影'),
      newQuickComposeMentionSegment(asset),
    ]);
    const stripped = stripCurrentViewFromQuickComposeSegments(segs);
    expect(stripped.some((s) => s.type === 'mention' && s.mention.kind === 'current_view')).toBe(false);
    expect(stripped.some((s) => s.type === 'mention' && s.mention.kind === 'asset')).toBe(true);
  });

  it('renumberQuickComposeDropZoneLabels: main all 图1, reference from 图2', () => {
    const main = renumberQuickComposeMainDropSlotLabels([
      { assetId: 'm1', previewSrc: 'a', label: 'x' },
      { assetId: 'm2', previewSrc: 'b', label: 'y' },
    ]);
    const ref = renumberQuickComposeReferenceDropSlotLabels([
      { assetId: 'r1', previewSrc: 'c', label: 'x' },
      { assetId: 'r2', previewSrc: 'd', label: 'y' },
    ]);
    expect(main.map((s) => s.label)).toEqual(['图1', '图1']);
    expect(ref.map((s) => s.label)).toEqual(['图2', '图3']);
  });

  it('resolveQuickComposeImageQueues splits main and reference zones', () => {
    const assets = [imageAsset('m1'), imageAsset('m2'), imageAsset('r1')];
    const mainDropSlots = renumberQuickComposeMainDropSlotLabels([
      { assetId: 'm1', previewSrc: 'data:image/png;base64,m1', label: '主1' },
      { assetId: 'm2', previewSrc: 'data:image/png;base64,m2', label: '主2' },
    ]);
    const referenceDropSlots = renumberQuickComposeReferenceDropSlotLabels([
      { assetId: 'r1', previewSrc: 'data:image/png;base64,r1', label: '参1' },
    ]);
    const q = resolveQuickComposeImageQueues({
      mainDropSlots,
      referenceDropSlots,
      assets,
      getAssetDisplayImage: (a) => a.original,
      maxRefs: 10,
    });
    expect(q.mainUrls).toEqual(['data:image/png;base64,m1', 'data:image/png;base64,m2']);
    expect(q.referenceUrls).toEqual(['data:image/png;base64,r1']);
  });

  it('buildQuickComposeTaskPromptOverride merges preset + context + user text once', () => {
    const built = buildQuickComposeTaskPromptOverride(
      '加亮前景',
      'data:main',
      ['data:ref1'],
      10,
      '预设说明'
    );
    expect(built.primary).toBe('data:main');
    expect(built.references).toEqual(['data:ref1']);
    expect(built.promptOverride).toContain('预设说明');
    expect(built.promptOverride).toContain('图1');
    expect(built.promptOverride).toContain('图2');
    expect(built.promptOverride).toContain('加亮前景');
    expect(built.promptOverride.split('加亮前景').length - 1).toBe(1);
  });

  it('resolveQuickComposeReferences returns userPrompt only when split queues active', () => {
    const assets = [imageAsset('m1'), imageAsset('r1')];
    const r = resolveQuickComposeReferences({
      segments: [newQuickComposeTextSegment('正文')],
      mainDropSlots: renumberQuickComposeMainDropSlotLabels([
        { assetId: 'm1', previewSrc: 'data:image/png;base64,m1', label: '主1' },
      ]),
      referenceDropSlots: renumberQuickComposeReferenceDropSlotLabels([
        { assetId: 'r1', previewSrc: 'data:image/png;base64,r1', label: '参1' },
      ]),
      assets,
      getAssetDisplayImage: (a) => a.original,
      maxRefs: 10,
    });
    expect(r.refs).toEqual([]);
    expect(r.userPrompt).toBe('正文');
    expect(r.referenceContextBlock).toBe('');
  });
});
