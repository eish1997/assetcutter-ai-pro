import { describe, expect, it } from 'vitest';

import type { WorkflowAsset } from '../types';
import {
  createQuickComposeMention,
  insertMentionTokenInDraft,
  newQuickComposeMentionSegment,
  newQuickComposeTextSegment,
  orderMentionsByDraft,
  relocateMentionSegment,
  resolveQuickComposeReferences,
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
    const ordered = orderMentionsByDraft('@主体 保持 @风格 晕染', [a, b]);
    expect(ordered.map((m) => m.label)).toEqual(['主体', '风格']);
  });

  it('resolves asset images and current view', () => {
    const assets = [imageAsset('a1', '图A'), imageAsset('a2', '图B')];
    const cv = createQuickComposeMention({ kind: 'current_view', label: QUICK_COMPOSE_CURRENT_VIEW_LABEL }, [])!;
    const m2 = createQuickComposeMention({ kind: 'asset', assetId: 'a2', label: '图B' }, [cv])!;
    const draft = `@${QUICK_COMPOSE_CURRENT_VIEW_LABEL} 改光影 @图B 构图`;
    const r = resolveQuickComposeReferences({
      draft,
      mentions: [cv, m2],
      assets,
      getAssetDisplayImage: (a) => a.original,
      maxRefs: 10,
      currentViewDataUrl: 'data:image/png;base64,view',
    });
    expect(r.refs).toEqual(['data:image/png;base64,view', 'data:image/png;base64,a2']);
    expect(r.userPrompt).toContain('改光影');
    expect(r.referenceContextBlock).toContain('当前画面');
    expect(r.referenceContextBlock).toContain('图B');
  });

  it('strips @ tokens from user prompt', () => {
    const m = createQuickComposeMention({ kind: 'asset', assetId: 'x', label: '测试图' }, [])!;
    expect(stripMentionTokensFromDraft('@测试图 加亮', [m])).toBe('加亮');
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
    const segments = [
      newQuickComposeTextSegment('前面'),
      newQuickComposeMentionSegment(m),
      newQuickComposeTextSegment('后面'),
    ];
    const r = resolveQuickComposeReferences({
      segments,
      assets,
      getAssetDisplayImage: (a) => a.original,
      maxRefs: 10,
    });
    expect(r.refs).toEqual(['data:image/png;base64,a1']);
    expect(r.userPrompt).toBe('前面 后面');
    expect(r.referenceContextBlock).toContain('图A');
    expect(r.referenceContextBlock).toContain('后面');
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
});
