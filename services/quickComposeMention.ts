import type { WorkflowAsset } from '../types';
import { isWorkflowTextAsset, workflowAssetToInputText } from './workflowTextAsset';

export const QUICK_COMPOSE_CURRENT_VIEW_LABEL = '当前画面';

export type QuickComposeMention =
  | { id: string; kind: 'asset'; assetId: string; label: string; previewSrc?: string }
  | { id: string; kind: 'current_view'; label: typeof QUICK_COMPOSE_CURRENT_VIEW_LABEL; previewSrc?: string };

/** 拖入输入区、待点击激活为 @ 的资产（仅来自拖放） */
export type QuickComposeDropSlot = {
  assetId: string;
  /** 列表/芯片展示用缩略图 */
  previewSrc: string;
  /** 无障碍 / 解析用，UI 默认不展示标题 */
  label: string;
};

export type QuickComposeMentionCandidate = {
  kind: 'asset' | 'current_view';
  assetId?: string;
  label: string;
  previewSrc?: string;
  disabled?: boolean;
  disabledReason?: string;
};

/** 内联混排：文字段与 @ 图引用段按书写顺序交替 */
export type QuickComposeTextSegment = { id: string; type: 'text'; value: string };
export type QuickComposeMentionSegment = { id: string; type: 'mention'; mention: QuickComposeMention };
export type QuickComposeSegment = QuickComposeTextSegment | QuickComposeMentionSegment;

export function newQuickComposeTextSegment(value = ''): QuickComposeTextSegment {
  return {
    id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: 'text',
    value,
  };
}

export function newQuickComposeMentionSegment(mention: QuickComposeMention): QuickComposeMentionSegment {
  return { id: `ms-${mention.id}`, type: 'mention', mention };
}

export function mentionsFromSegments(segments: QuickComposeSegment[]): QuickComposeMention[] {
  return segments.filter((s): s is QuickComposeMentionSegment => s.type === 'mention').map((s) => s.mention);
}

export function draftFromSegments(segments: QuickComposeSegment[]): string {
  return segments
    .filter((s): s is QuickComposeTextSegment => s.type === 'text')
    .map((s) => s.value)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeQuickComposeSegments(segments: QuickComposeSegment[]): QuickComposeSegment[] {
  const out: QuickComposeSegment[] = [];
  for (const s of segments) {
    if (s.type === 'text') {
      const last = out[out.length - 1];
      if (last?.type === 'text') {
        out[out.length - 1] = { ...last, value: last.value + s.value };
      } else {
        out.push({ ...s });
      }
    } else {
      out.push(s);
    }
  }
  return out;
}

/** 保证首尾可输入；mention 两侧保留空 text 段以便继续打字 */
export function ensureQuickComposeEditableBoundaries(segments: QuickComposeSegment[]): QuickComposeSegment[] {
  let segs = normalizeQuickComposeSegments(segments);
  if (segs.length === 0) return [newQuickComposeTextSegment('')];
  if (segs[0]!.type === 'mention') segs = [newQuickComposeTextSegment(''), ...segs];
  if (segs[segs.length - 1]!.type === 'mention') segs = [...segs, newQuickComposeTextSegment('')];
  return segs;
}

export function insertMentionInSegments(
  segments: QuickComposeSegment[],
  segmentId: string,
  offset: number,
  mention: QuickComposeMention,
  options?: { stripAtQuery?: boolean }
): QuickComposeSegment[] {
  const idx = segments.findIndex((s) => s.id === segmentId);
  if (idx < 0) return ensureQuickComposeEditableBoundaries(segments);
  const seg = segments[idx];
  if (seg.type !== 'text') return ensureQuickComposeEditableBoundaries(segments);

  let before = seg.value.slice(0, Math.max(0, offset));
  const after = seg.value.slice(Math.max(0, offset));
  if (options?.stripAtQuery) {
    const at = before.lastIndexOf('@');
    if (at >= 0) before = before.slice(0, at);
  }

  const parts: QuickComposeSegment[] = [];
  if (before.length > 0) parts.push({ ...newQuickComposeTextSegment(before), id: seg.id });
  parts.push(newQuickComposeMentionSegment(mention));
  if (after.length > 0) parts.push(newQuickComposeTextSegment(after));
  else parts.push(newQuickComposeTextSegment(''));

  return ensureQuickComposeEditableBoundaries([...segments.slice(0, idx), ...parts, ...segments.slice(idx + 1)]);
}

/** 将 mention 段移动到另一段之前（targetSegmentId 所在段；mention 不可拖到 text 内部） */
export function moveMentionBeforeSegment(
  segments: QuickComposeSegment[],
  mentionId: string,
  targetSegmentId: string
): QuickComposeSegment[] {
  return relocateMentionSegment(segments, mentionId, { mode: 'before', segmentId: targetSegmentId });
}

export type QuickComposeDropAnchor =
  | { mode: 'text'; segmentId: string; offset: number }
  | { mode: 'before'; segmentId: string }
  | { mode: 'after'; segmentId: string };

/** 按鼠标落点将 @ 图插入文字中间或段前/段后 */
export function relocateMentionSegment(
  segments: QuickComposeSegment[],
  mentionId: string,
  anchor: QuickComposeDropAnchor
): QuickComposeSegment[] {
  const fromIdx = segments.findIndex((s) => s.type === 'mention' && s.mention.id === mentionId);
  if (fromIdx < 0) return segments;
  const mentionSeg = segments[fromIdx] as QuickComposeMentionSegment;
  let next = segments.filter((_, i) => i !== fromIdx);

  if (anchor.mode === 'text') {
    const textIdx = next.findIndex((s) => s.id === anchor.segmentId && s.type === 'text');
    if (textIdx < 0) return ensureQuickComposeEditableBoundaries(next);
    const t = next[textIdx] as QuickComposeTextSegment;
    const off = Math.max(0, Math.min(anchor.offset, t.value.length));
    const before = t.value.slice(0, off);
    const after = t.value.slice(off);
    const parts: QuickComposeSegment[] = [];
    if (before.length > 0) parts.push({ ...t, value: before });
    parts.push(mentionSeg);
    if (after.length > 0) parts.push(newQuickComposeTextSegment(after));
    else parts.push(newQuickComposeTextSegment(''));
    next = [...next.slice(0, textIdx), ...parts, ...next.slice(textIdx + 1)];
    return ensureQuickComposeEditableBoundaries(next);
  }

  const toIdx = next.findIndex((s) => s.id === anchor.segmentId);
  if (toIdx < 0) return ensureQuickComposeEditableBoundaries(next);
  const insertAt = anchor.mode === 'before' ? toIdx : toIdx + 1;
  return ensureQuickComposeEditableBoundaries([
    ...next.slice(0, insertAt),
    mentionSeg,
    ...next.slice(insertAt),
  ]);
}

export function removeMentionFromSegments(
  segments: QuickComposeSegment[],
  mentionId: string
): QuickComposeSegment[] {
  const next = segments.filter((s) => !(s.type === 'mention' && s.mention.id === mentionId));
  return ensureQuickComposeEditableBoundaries(next);
}

export function updateTextSegmentValue(
  segments: QuickComposeSegment[],
  segmentId: string,
  value: string
): QuickComposeSegment[] {
  return segments.map((s) => (s.id === segmentId && s.type === 'text' ? { ...s, value } : s));
}

export type ResolveQuickComposeRefsInput = {
  /** 优先：按段顺序解析参考图与提示词 */
  segments?: QuickComposeSegment[];
  draft?: string;
  mentions?: QuickComposeMention[];
  assets: WorkflowAsset[];
  getAssetDisplayImage: (asset: WorkflowAsset) => string;
  maxRefs: number;
  /** 大图 `@当前画面` 解析后的 dataUrl；无则跳过该 mention */
  currentViewDataUrl?: string;
};

export type ResolveQuickComposeRefsResult = {
  refs: string[];
  /** 去掉 @label 占位后的用户自然语言 */
  userPrompt: string;
  /** 直发时拼进 instruction 的参考说明块 */
  referenceContextBlock: string;
  warnings: string[];
};

export function workflowAssetMentionLabel(asset: WorkflowAsset): string {
  const title = (asset.textTitle || '').trim();
  if (title) return title.length > 28 ? `${title.slice(0, 28)}…` : title;
  const gl = (asset.groupLabel || '').trim();
  if (gl) return gl.length > 28 ? `${gl.slice(0, 28)}…` : gl;
  return `图·${asset.id.slice(0, 8)}`;
}

/** @ 候选：仅来自已拖入输入区的资产 + 可选「当前画面」 */
export function listDropSlotMentionCandidates(
  dropSlots: QuickComposeDropSlot[],
  mentions: QuickComposeMention[],
  options?: { includeCurrentView?: boolean; currentViewPreviewSrc?: string }
): QuickComposeMentionCandidate[] {
  const mentionedIds = new Set(
    mentions.filter((m): m is Extract<QuickComposeMention, { kind: 'asset' }> => m.kind === 'asset').map((m) => m.assetId)
  );
  const out: QuickComposeMentionCandidate[] = [];
  if (options?.includeCurrentView && !mentions.some((m) => m.kind === 'current_view')) {
    out.push({
      kind: 'current_view',
      label: QUICK_COMPOSE_CURRENT_VIEW_LABEL,
      previewSrc: options.currentViewPreviewSrc,
    });
  }
  for (const s of dropSlots) {
    if (mentionedIds.has(s.assetId)) continue;
    out.push({
      kind: 'asset',
      assetId: s.assetId,
      label: s.label,
      previewSrc: s.previewSrc,
    });
  }
  return out;
}

export function listQuickComposeMentionCandidates(
  assets: WorkflowAsset[],
  options?: { includeCurrentView?: boolean; archivedVisible?: boolean }
): QuickComposeMentionCandidate[] {
  const out: QuickComposeMentionCandidate[] = [];
  if (options?.includeCurrentView) {
    out.push({ kind: 'current_view', label: QUICK_COMPOSE_CURRENT_VIEW_LABEL });
  }
  for (const a of assets) {
    if (a.archived && !options?.archivedVisible) continue;
    if (a.hiddenInGrid) continue;
    if (a.isGroup) continue;
    out.push({
      kind: 'asset',
      assetId: a.id,
      label: workflowAssetMentionLabel(a),
    });
  }
  return out;
}

export function createQuickComposeMention(
  candidate: QuickComposeMentionCandidate,
  existing: QuickComposeMention[]
): QuickComposeMention | null {
  if (candidate.kind === 'current_view') {
    if (existing.some((m) => m.kind === 'current_view')) return null;
    return {
      id: `cv-${Date.now()}`,
      kind: 'current_view',
      label: QUICK_COMPOSE_CURRENT_VIEW_LABEL,
      previewSrc: candidate.previewSrc,
    };
  }
  const assetId = (candidate.assetId || '').trim();
  if (!assetId) return null;
  if (existing.some((m) => m.kind === 'asset' && m.assetId === assetId)) return null;
  let label = candidate.label.trim() || `图·${assetId.slice(0, 8)}`;
  const labelsUsed = new Set(existing.map((m) => m.label));
  if (labelsUsed.has(label)) {
    let n = 2;
    while (labelsUsed.has(`${label} (${n})`)) n += 1;
    label = `${label} (${n})`;
  }
  return { id: `a-${assetId}-${Date.now()}`, kind: 'asset', assetId, label, previewSrc: candidate.previewSrc };
}

/** 在 draft 中插入 `@label `（光标处或末尾） */
export function insertMentionTokenInDraft(draft: string, label: string, caret?: number): string {
  const token = `@${label} `;
  if (caret == null || caret < 0 || caret > draft.length) {
    const sep = draft.length > 0 && !/\s$/.test(draft) ? ' ' : '';
    return `${draft}${sep}${token}`;
  }
  return `${draft.slice(0, caret)}${token}${draft.slice(caret)}`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 按 draft 中 `@label` 出现顺序排列 mentions；未出现在文案中的 mention 追加在末尾（chip 仍生效） */
export function orderMentionsForResolve(draft: string, mentions: QuickComposeMention[]): QuickComposeMention[] {
  const inDraft = orderMentionsByDraft(draft, mentions);
  const seen = new Set(inDraft.map((m) => m.id));
  for (const m of mentions) {
    if (!seen.has(m.id)) {
      inDraft.push(m);
      seen.add(m.id);
    }
  }
  return inDraft;
}

/** 按 draft 中 `@label` 出现顺序排列 mentions；未出现在文案中的 mention 排在末尾 */
export function orderMentionsByDraft(draft: string, mentions: QuickComposeMention[]): QuickComposeMention[] {
  const positions: Array<{ m: QuickComposeMention; index: number }> = [];
  for (const m of mentions) {
    const re = new RegExp(`@${escapeRegExp(m.label)}(?=\\s|$|[，。,.;!?])`);
    const match = re.exec(draft);
    positions.push({ m, index: match ? match.index : Number.MAX_SAFE_INTEGER });
  }
  return positions
    .sort((a, b) => a.index - b.index || mentions.indexOf(a.m) - mentions.indexOf(b.m))
    .map((x) => x.m);
}

function segmentHintForMention(draft: string, mention: QuickComposeMention, all: QuickComposeMention[]): string {
  const re = new RegExp(`@${escapeRegExp(mention.label)}`);
  const match = re.exec(draft);
  if (!match) return '';
  let start = match.index + match[0].length;
  let end = draft.length;
  for (const other of all) {
    if (other.id === mention.id) continue;
    const oRe = new RegExp(`@${escapeRegExp(other.label)}`);
    const oMatch = oRe.exec(draft.slice(start));
    if (oMatch && oMatch.index >= 0) {
      end = Math.min(end, start + oMatch.index);
    }
  }
  return draft.slice(start, end).replace(/^\s+/, '').replace(/\s+$/, '');
}

export function stripMentionTokensFromDraft(draft: string, mentions: QuickComposeMention[]): string {
  let out = draft;
  for (const m of mentions) {
    out = out.replace(new RegExp(`@${escapeRegExp(m.label)}\\s*`, 'g'), ' ');
  }
  return out.replace(/\s+/g, ' ').trim();
}

function hintAfterMentionInSegments(segments: QuickComposeSegment[], mentionIndex: number): string {
  for (let j = mentionIndex + 1; j < segments.length; j += 1) {
    const s = segments[j]!;
    if (s.type === 'text') return s.value.trim();
    if (s.type === 'mention') break;
  }
  return '';
}

function resolveQuickComposeFromSegments(
  segments: QuickComposeSegment[],
  input: Omit<ResolveQuickComposeRefsInput, 'segments' | 'draft' | 'mentions'>
): ResolveQuickComposeRefsResult {
  const warnings: string[] = [];
  const ordered = mentionsFromSegments(segments);
  const refs: string[] = [];
  const refLines: string[] = [];
  const assetById = new Map(input.assets.map((a) => [a.id, a]));

  for (let si = 0; si < segments.length; si += 1) {
    const seg = segments[si]!;
    if (seg.type !== 'mention') continue;
    const m = seg.mention;
    const refIndex = ordered.findIndex((x) => x.id === m.id);
    const hint = hintAfterMentionInSegments(segments, si);
    const i = refIndex >= 0 ? refIndex : 0;
    if (m.kind === 'current_view') {
      const url = String(input.currentViewDataUrl || '').trim();
      if (!url.startsWith('data:image/') && !url.startsWith('blob:') && !/^https?:\/\//i.test(url)) {
        warnings.push('「当前画面」未能解析为有效图片，已跳过');
        continue;
      }
      if (!refs.includes(url)) refs.push(url);
      refLines.push(
        `【参考图 ${i + 1}：${m.label}】${hint ? `说明：${hint}` : '以提交时截取的画面为准。'}`
      );
      continue;
    }
    const asset = assetById.get(m.assetId);
    if (!asset) {
      warnings.push(`未找到资产「${m.label}」，已跳过`);
      continue;
    }
    if (isWorkflowTextAsset(asset)) {
      const text = workflowAssetToInputText(asset).trim();
      if (text) {
        refLines.push(`【参考 ${i + 1}：${m.label}（文字）】${hint ? `${hint}\n` : ''}${text}`);
      } else {
        warnings.push(`文字资产「${m.label}」无正文，已跳过`);
      }
      continue;
    }
    const img = input.getAssetDisplayImage(asset).trim();
    if (!img) {
      warnings.push(`资产「${m.label}」无可用图片，已跳过`);
      continue;
    }
    if (!refs.includes(img)) refs.push(img);
    refLines.push(`【参考图 ${i + 1}：${m.label}】${hint ? `说明：${hint}` : '见画面。'}`);
  }

  const capped = refs.slice(0, Math.max(0, input.maxRefs));
  if (refs.length > capped.length) {
    warnings.push(`参考图超过上限（${input.maxRefs} 张），已截断`);
  }

  const userPrompt = draftFromSegments(segments);
  const referenceContextBlock = refLines.length > 0 ? refLines.join('\n') : '';

  return { refs: capped, userPrompt, referenceContextBlock, warnings };
}

export function resolveQuickComposeReferences(input: ResolveQuickComposeRefsInput): ResolveQuickComposeRefsResult {
  if (input.segments && input.segments.length > 0) {
    return resolveQuickComposeFromSegments(input.segments, input);
  }
  const draft = input.draft ?? '';
  const mentions = input.mentions ?? [];
  const warnings: string[] = [];
  const ordered = orderMentionsForResolve(draft, mentions);
  const refs: string[] = [];
  const refLines: string[] = [];
  const assetById = new Map(input.assets.map((a) => [a.id, a]));

  for (let i = 0; i < ordered.length; i += 1) {
    const m = ordered[i]!;
    const hint = segmentHintForMention(draft, m, ordered);
    if (m.kind === 'current_view') {
      const url = String(input.currentViewDataUrl || '').trim();
      if (!url.startsWith('data:image/') && !url.startsWith('blob:') && !/^https?:\/\//i.test(url)) {
        warnings.push('「当前画面」未能解析为有效图片，已跳过');
        continue;
      }
      if (!refs.includes(url)) refs.push(url);
      refLines.push(
        `【参考图 ${i + 1}：${m.label}】${hint ? `说明：${hint}` : '以提交时截取的画面为准。'}`
      );
      continue;
    }
    const asset = assetById.get(m.assetId);
    if (!asset) {
      warnings.push(`未找到资产「${m.label}」，已跳过`);
      continue;
    }
    if (isWorkflowTextAsset(asset)) {
      const text = workflowAssetToInputText(asset).trim();
      if (text) {
        refLines.push(`【参考 ${i + 1}：${m.label}（文字）】${hint ? `${hint}\n` : ''}${text}`);
      } else {
        warnings.push(`文字资产「${m.label}」无正文，已跳过`);
      }
      continue;
    }
    const img = input.getAssetDisplayImage(asset).trim();
    if (!img) {
      warnings.push(`资产「${m.label}」无可用图片，已跳过`);
      continue;
    }
    if (!refs.includes(img)) refs.push(img);
    refLines.push(`【参考图 ${i + 1}：${m.label}】${hint ? `说明：${hint}` : '见画面。'}`);
  }

  const capped = refs.slice(0, Math.max(0, input.maxRefs));
  if (refs.length > capped.length) {
    warnings.push(`参考图超过上限（${input.maxRefs} 张），已截断`);
  }

  const userPrompt = stripMentionTokensFromDraft(draft, mentions);
  const referenceContextBlock = refLines.length > 0 ? refLines.join('\n') : '';

  return { refs: capped, userPrompt, referenceContextBlock, warnings };
}

/** 合并用户句 + 参考说明，供入队 promptOverride / 理解 */
export function buildQuickComposePromptOverride(
  userPrompt: string,
  referenceContextBlock: string,
  presetInstruction?: string
): string {
  const parts = [presetInstruction?.trim(), referenceContextBlock.trim(), userPrompt.trim()].filter(Boolean);
  return parts.join('\n\n');
}
