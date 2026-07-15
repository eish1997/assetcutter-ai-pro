import { describe, expect, it } from 'vitest';
import type { WorkflowAsset } from '../types';
import type { QuickComposeThreadMessage } from '../types/quickComposeThread';
import {
  collectQuickComposeAttachmentAssetIds,
  deriveQuickComposeSuggestedActions,
  mapQuickComposeThreadMessageToChatView,
} from '../services/quickComposeChatView';
import { newQuickComposeMentionSegment, newQuickComposeTextSegment } from '../services/quickComposeMention';
import { quickComposeChatActionNeedsConfirm } from '../components/workflow/quickComposeChat/chatUiCopy';

const imageAsset = (id: string, src: string): WorkflowAsset =>
  ({
    id,
    original: src,
    displayKey: 'original',
    results: {},
    resultOrder: [],
    archived: false,
    hiddenInGrid: false,
    createdAt: 1,
  }) as WorkflowAsset;

const textToImageAsset = (id: string, stepKey: string, src: string): WorkflowAsset =>
  ({
    id,
    original: '',
    displayKey: stepKey,
    results: { [stepKey]: src },
    resultOrder: [stepKey],
    archived: false,
    hiddenInGrid: false,
    createdAt: 1,
    assetKind: 'text',
    textBody: 'make a poster',
  }) as WorkflowAsset;

describe('collectQuickComposeAttachmentAssetIds', () => {
  it('collects drop slots and @ asset mentions', () => {
    const ids = collectQuickComposeAttachmentAssetIds({
      segments: [
        newQuickComposeTextSegment('hello '),
        newQuickComposeMentionSegment({
          id: 'm1',
          kind: 'asset',
          assetId: 'a-mention',
          label: 'M',
        }),
      ],
      mainDropSlots: [{ assetId: 'a-main', previewSrc: '', label: 'M' }],
      referenceDropSlots: [{ assetId: 'a-ref', previewSrc: '', label: 'R' }],
    });
    expect(ids.sort()).toEqual(['a-main', 'a-mention', 'a-ref']);
  });

  it('includes current_view as lightbox asset id', () => {
    const ids = collectQuickComposeAttachmentAssetIds({
      segments: [
        newQuickComposeMentionSegment({
          id: 'cv',
          kind: 'current_view',
          label: '当前画面',
        }),
      ],
      mainDropSlots: [],
      referenceDropSlots: [],
      lightboxAssetId: 'lb-1',
    });
    expect(ids).toEqual(['lb-1']);
  });
});

describe('mapQuickComposeThreadMessageToChatView', () => {
  const ctx = {
    assets: [imageAsset('a1', 'data:image/png;base64,abc')],
    pending: [],
    executingQueue: null,
    getAssetDisplayImage: (a: WorkflowAsset) => a.original,
    getAssetLabel: (a: WorkflowAsset) => a.id,
  };

  it('maps user attachment thumbs from assetIds', () => {
    const msg: QuickComposeThreadMessage = {
      id: 'u1',
      role: 'user',
      text: 'hi',
      timestamp: 1,
      assetIds: ['a1'],
    };
    const view = mapQuickComposeThreadMessageToChatView(msg, ctx);
    expect(view.attachmentThumbs).toEqual([
      { id: 'a1', previewSrc: 'data:image/png;base64,abc', label: 'a1' },
    ]);
  });

  it('maps assistant result thumb when done', () => {
    const msg: QuickComposeThreadMessage = {
      id: 'as1',
      role: 'assistant',
      text: 'ok',
      timestamp: 2,
      status: 'done',
      taskIds: ['t1'],
    };
    const view = mapQuickComposeThreadMessageToChatView(msg, {
      ...ctx,
      pending: [{ id: 't1', assetId: 'a1', actionType: 'gen', addedAt: 1 } as never],
    });
    expect(view.resultThumb?.id).toBe('a1');
    expect(view.resultCard).toMatchObject({
      title: '已创建资产',
      assetIds: ['a1'],
      summary: '已创建 1 个资产。',
    });
  });

  it('maps assistant result thumb for text-to-image assets with image display versions', () => {
    const asset = textToImageAsset('txt-img-1', 'text_to_image:1', '/api/assets/txt-img-1.png');
    const msg: QuickComposeThreadMessage = {
      id: 'as-t2i',
      role: 'assistant',
      text: 'ok',
      timestamp: 2,
      status: 'done',
      taskIds: ['t-t2i'],
      taskAssetById: { 't-t2i': 'txt-img-1' },
    };
    const view = mapQuickComposeThreadMessageToChatView(msg, {
      ...ctx,
      assets: [asset],
      getAssetDisplayImage: (a: WorkflowAsset) =>
        String(a.results?.[a.displayKey] || a.original || ''),
    });
    expect(view.resultThumb).toEqual({
      id: 'txt-img-1',
      previewSrc: '/api/assets/txt-img-1.png',
      label: 'txt-img-1',
    });
  });

  it('derives lightweight next actions for done assistant messages', () => {
    const msg: QuickComposeThreadMessage = {
      id: 'as-actions',
      role: 'assistant',
      text: '计划：文生图',
      timestamp: 3,
      status: 'done',
      taskIds: ['t1'],
    };
    const actions = deriveQuickComposeSuggestedActions(msg, { hasResultThumb: true });
    expect(actions.map((a) => a.id)).toContain('continue_refine');
    expect(actions.map((a) => a.id)).toContain('try_variant');
    expect(actions.find((a) => a.id === 'continue_refine')?.label).toBe('继续');
    expect(actions.find((a) => a.id === 'try_variant')?.label).toBe('调整');
    expect(actions.map((a) => a.id)).not.toContain('view_details');
    expect(actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'save_memory',
          kind: 'save_memory',
          confirmLevel: 'light',
        }),
      ])
    );
    expect(actions.map((a) => a.id)).toContain('use_as_reference');
  });

  it('derives recovery actions for failed assistant messages', () => {
    const msg: QuickComposeThreadMessage = {
      id: 'as-error',
      role: 'assistant',
      text: 'timeout',
      timestamp: 4,
      status: 'error',
      errorMessage: 'timeout',
    };
    const actions = deriveQuickComposeSuggestedActions(msg);
    expect(actions[0]?.kind).toBe('retry');
    expect(actions[0]).toMatchObject({
      confirmLevel: 'cost',
      riskLevel: 'medium',
      targetScope: 'current',
    });
    expect(actions.some((a) => a.id === 'plan_only')).toBe(true);
    expect(actions.some((a) => a.id === 'keep_draft')).toBe(true);
    expect(actions.some((a) => a.id === 'back_one_step')).toBe(true);
    expect(actions.some((a) => a.id === 'view_details')).toBe(true);
  });
});

describe('quick compose chat action confirmation rules', () => {
  it('uses minimal local action shapes for confirm decisions', () => {
    expect(quickComposeChatActionNeedsConfirm({ kind: 'reply' })).toBe(false);
    expect(quickComposeChatActionNeedsConfirm({ kind: 'open_panel', action: 'asset_detail' })).toBe(false);
    expect(quickComposeChatActionNeedsConfirm({ kind: 'apply', confirmLevel: 'cost' })).toBe(true);
    expect(quickComposeChatActionNeedsConfirm({ kind: 'run_tool', requiresCost: true })).toBe(true);
    expect(quickComposeChatActionNeedsConfirm({ kind: 'discard_result', isDestructive: true })).toBe(true);
  });
});
