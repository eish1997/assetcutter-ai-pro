import type { QuickComposeSegment } from './quickComposeMention';
import { mentionsFromSegments } from './quickComposeMention';

export type ComposerSendableContentInput = {
  draft: string;
  segments?: QuickComposeSegment[];
  promptCardCount?: number;
};

/**
 * Dock 发送门禁：与 submitQuickComposeWithThread 可入队条件对齐。
 * draftFromSegments 不含 mention 芯片文本，故仅看 trim(draft) 会误禁用「仅 @专家 / 仅预设卡」。
 */
export function composerHasSendableContent(input: ComposerSendableContentInput): boolean {
  if (String(input.draft ?? '').trim()) return true;
  if ((input.promptCardCount ?? 0) > 0) return true;
  const mentions = mentionsFromSegments(input.segments ?? []);
  return mentions.some((m) => m.kind === 'expert' || m.kind === 'asset');
}
