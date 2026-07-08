import { describe, expect, it } from 'vitest';
import type { WorkflowAsset } from '../types';
import type { QuickComposeThreadMessage } from '../types/quickComposeThread';
import {
  collectQuickComposeAttachmentAssetIds,
  mapQuickComposeThreadMessageToChatView,
} from '../services/quickComposeChatView';
import { newQuickComposeMentionSegment, newQuickComposeTextSegment } from '../services/quickComposeMention';

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
  });
});
