import { describe, expect, it } from 'vitest';
import {
  newQuickComposeMentionSegment,
  newQuickComposeTextSegment,
  type QuickComposeSegment,
} from '../services/quickComposeMention';
import { composerHasSendableContent } from '../services/quickComposeSendGate';

function segmentsWithExpert(): QuickComposeSegment[] {
  return [
    newQuickComposeTextSegment(''),
    newQuickComposeMentionSegment({
      id: 'ex-1',
      kind: 'expert',
      expertId: 'expert.prompt_smith',
      label: '提示词专家',
    }),
    newQuickComposeTextSegment(''),
  ];
}

function segmentsWithAsset(): QuickComposeSegment[] {
  return [
    newQuickComposeTextSegment(''),
    newQuickComposeMentionSegment({
      id: 'a-1',
      kind: 'asset',
      assetId: 'asset-1',
      label: '图1',
    }),
    newQuickComposeTextSegment(''),
  ];
}

describe('composerHasSendableContent', () => {
  it('returns false for empty draft, no mentions, no prompt cards', () => {
    expect(
      composerHasSendableContent({
        draft: '   ',
        segments: [newQuickComposeTextSegment('')],
        promptCardCount: 0,
      })
    ).toBe(false);
  });

  it('returns true when only expert mention (empty draft)', () => {
    expect(
      composerHasSendableContent({
        draft: '',
        segments: segmentsWithExpert(),
        promptCardCount: 0,
      })
    ).toBe(true);
  });

  it('returns true when only asset mention (empty draft)', () => {
    expect(
      composerHasSendableContent({
        draft: '',
        segments: segmentsWithAsset(),
        promptCardCount: 0,
      })
    ).toBe(true);
  });

  it('returns true when only prompt cards (empty draft, no mentions)', () => {
    expect(
      composerHasSendableContent({
        draft: '',
        segments: [newQuickComposeTextSegment('')],
        promptCardCount: 1,
      })
    ).toBe(true);
  });

  it('returns true when draft has text', () => {
    expect(
      composerHasSendableContent({
        draft: '你好',
        segments: [newQuickComposeTextSegment('你好')],
        promptCardCount: 0,
      })
    ).toBe(true);
  });
});
