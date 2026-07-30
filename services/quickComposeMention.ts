import type { WorkflowAsset } from '../types';
import {
  collectReferencedPbrTextureAssetIdsFromAssets,
  isWorkflowAssetHiddenFromAssetGrid,
  type WorkflowModelPbrTextureRewriteTarget,
} from './workflowModelPbrEdits';
import { isWorkflowTextAsset, workflowAssetToInputText } from './workflowTextAsset';

export const QUICK_COMPOSE_CURRENT_VIEW_LABEL = '当前画面';

export type QuickComposeMention =
  | { id: string; kind: 'asset'; assetId: string; label: string; previewSrc?: string }
  | { id: string; kind: 'current_view'; label: typeof QUICK_COMPOSE_CURRENT_VIEW_LABEL; previewSrc?: string }
  | { id: string; kind: 'expert'; expertId: string; label: string; previewSrc?: string };

/** 拖入输入区、按顺序送模的参考图（无需 @） */
export type QuickComposeDropSlot = {
  assetId: string;
  /** 列表/芯片展示用缩略图 */
  previewSrc: string;
  /** 无障碍 / 解析用，UI 默认不展示标题 */
  label: string;
  modelPbrTextureRewriteTarget?: WorkflowModelPbrTextureRewriteTarget;
};

export type QuickComposeMentionCandidate = {
  kind: 'asset' | 'current_view' | 'expert';
  assetId?: string;
  expertId?: string;
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

/** 移除「当前画面」@ 引用（大图关闭时不污染全局快捷栏） */
export function stripCurrentViewFromQuickComposeSegments(segments: QuickComposeSegment[]): QuickComposeSegment[] {
  const filtered = segments.filter(
    (s) => !(s.type === 'mention' && s.mention.kind === 'current_view')
  );
  if (filtered.length === 0) return [newQuickComposeTextSegment('')];
  return ensureQuickComposeEditableBoundaries(filtered);
}

export function draftFromSegments(segments: QuickComposeSegment[]): string {
  return segments
    .filter((s): s is QuickComposeTextSegment => s.type === 'text')
    .map((s) => s.value)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 夹在两个 @ 之间的 text 段：仅作前一图的短说明，不进入 userPrompt */
function isInterstitialHintTextSegment(segments: QuickComposeSegment[], textIndex: number): boolean {
  const seg = segments[textIndex];
  if (!seg || seg.type !== 'text') return false;
  const prev = textIndex > 0 ? segments[textIndex - 1] : null;
  const next = textIndex < segments.length - 1 ? segments[textIndex + 1] : null;
  return prev?.type === 'mention' && next?.type === 'mention';
}

/** 用户自然语言：排除已写入 referenceContextBlock 的「夹心」短说明 */
export function userPromptFromSegments(segments: QuickComposeSegment[]): string {
  const parts: string[] = [];
  for (let i = 0; i < segments.length; i += 1) {
    const s = segments[i]!;
    if (s.type !== 'text' || isInterstitialHintTextSegment(segments, i)) continue;
    const t = s.value.trim();
    if (t) parts.push(t);
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
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

/** 快捷栏 @ 图片序号（1-based，与 API 送图顺序一致） */
export function quickComposeImageMentionLabel(ordinal: number): string {
  return `图${Math.max(1, Math.floor(ordinal))}`;
}

function isQuickComposeImageMentionKind(m: QuickComposeMention): boolean {
  return m.kind === 'current_view' || m.kind === 'asset';
}

/** 按 segments 从左到右为 @ 图片重排 图1、图2…（拖拽/删除后同步） */
export function renumberQuickComposeImageMentionLabels(segments: QuickComposeSegment[]): QuickComposeSegment[] {
  let n = 0;
  return segments.map((s) => {
    if (s.type !== 'mention' || !isQuickComposeImageMentionKind(s.mention)) return s;
    n += 1;
    const label = quickComposeImageMentionLabel(n);
    if (s.mention.label === label) return s;
    return { ...s, mention: { ...s.mention, label } };
  });
}

/** 保证首尾可输入；mention 两侧保留空 text 段以便继续打字 */
export function ensureQuickComposeEditableBoundaries(segments: QuickComposeSegment[]): QuickComposeSegment[] {
  let segs = normalizeQuickComposeSegments(segments);
  if (segs.length === 0) return [newQuickComposeTextSegment('')];
  if (segs[0]!.type === 'mention') segs = [newQuickComposeTextSegment(''), ...segs];
  if (segs[segs.length - 1]!.type === 'mention') segs = [...segs, newQuickComposeTextSegment('')];
  return renumberQuickComposeImageMentionLabels(segs);
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

export type QuickComposeDropZone = 'main' | 'reference';

export type ResolveQuickComposeRefsInput = {
  /** 优先：按段顺序解析参考图与提示词 */
  segments?: QuickComposeSegment[];
  draft?: string;
  mentions?: QuickComposeMention[];
  /** @deprecated 请用 mainDropSlots + referenceDropSlots */
  dropSlots?: QuickComposeDropSlot[];
  /** 主图区：每张单独一条任务 */
  mainDropSlots?: QuickComposeDropSlot[];
  /** 参考图区：每条主图任务共用 */
  referenceDropSlots?: QuickComposeDropSlot[];
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

/** 快捷栏 / 队列：第一张为主图，其余为参考（顺序与拖入或 @ 出现一致） */
export function splitPrimaryAndReferenceImageUrls(urls: string[]): {
  primary: string;
  references: string[];
} {
  const list = urls.map((s) => String(s || '').trim()).filter(Boolean);
  if (list.length === 0) return { primary: '', references: [] };
  return { primary: list[0]!, references: list.slice(1) };
}

/** 生图 API：主图在前，参考图在后（去重，兼容旧任务 inputImages 含主图） */
export function mergePrimaryAndReferenceImageUrls(primary: string, references: string[]): string[] {
  const out: string[] = [];
  const p = String(primary || '').trim();
  if (p) out.push(p);
  for (const raw of references) {
    const s = String(raw || '').trim();
    if (!s || out.includes(s)) continue;
    out.push(s);
  }
  return out;
}

/** 与 API inline 顺序一致：图1 = 第 1 张 parts，图2 = 第 2 张…（1-based，无「图 0」） */
function quickComposeImageContextLine(
  imageIndex: number,
  hint: string,
  kind: QuickComposeMention['kind']
): string {
  const numLabel = quickComposeImageMentionLabel(imageIndex + 1);
  if (imageIndex === 0) {
    return `【${numLabel}（待编辑主图）】${hint ? `说明：${hint}` : '按此图为基础编辑。'}`;
  }
  const defaultHint = kind === 'current_view' ? '以提交时截取的画面为准。' : '见画面。';
  return `【${numLabel}】${hint ? `说明：${hint}` : defaultHint}`;
}

/** 按拖入顺序为待送模图片生成【图1】【图2】说明块 */
export function buildImageReferenceContextBlock(imageCount: number): string {
  const lines: string[] = [];
  for (let i = 0; i < imageCount; i += 1) {
    lines.push(quickComposeImageContextLine(i, '', 'asset'));
  }
  return lines.join('\n');
}

/** 拖入区 UI：主图区统一显示图1（每张主图在各自任务中均为图1） */
export function quickComposeMainDropSlotLabel(_ordinal?: number): string {
  return quickComposeImageMentionLabel(1);
}

/** 拖入区 UI：参考图区从图2起按顺序编号 */
export function quickComposeReferenceDropSlotLabel(ordinal: number): string {
  return quickComposeImageMentionLabel(Math.max(2, Math.floor(ordinal) + 1));
}

/** 拖入区序号（兼容旧单队列） */
export function renumberQuickComposeDropSlotLabels(slots: QuickComposeDropSlot[]): QuickComposeDropSlot[] {
  return slots.map((s, i) => ({
    ...s,
    label: quickComposeImageMentionLabel(i + 1),
  }));
}

export function renumberQuickComposeMainDropSlotLabels(slots: QuickComposeDropSlot[]): QuickComposeDropSlot[] {
  const label = quickComposeMainDropSlotLabel();
  return slots.map((s) => ({
    ...s,
    label,
  }));
}

export function renumberQuickComposeReferenceDropSlotLabels(slots: QuickComposeDropSlot[]): QuickComposeDropSlot[] {
  return slots.map((s, i) => ({
    ...s,
    label: quickComposeReferenceDropSlotLabel(i + 1),
  }));
}

function urlsFromDropSlots(
  slots: QuickComposeDropSlot[],
  assets: WorkflowAsset[],
  getAssetDisplayImage: (asset: WorkflowAsset) => string,
  warnings: string[],
  emptyLabel: string
): string[] {
  const refs: string[] = [];
  const assetById = new Map(assets.map((a) => [a.id, a]));
  for (const slot of slots) {
    const asset = assetById.get(slot.assetId);
    const img = (asset ? getAssetDisplayImage(asset) : slot.previewSrc).trim();
    if (!img) {
      warnings.push(`${emptyLabel}「${slot.label}」无可用图片，已跳过`);
      continue;
    }
    if (!refs.includes(img)) refs.push(img);
  }
  return refs;
}

export type QuickComposeImageQueuesResult = {
  mainUrls: string[];
  referenceUrls: string[];
  warnings: string[];
};

/** 主图区 + 参考图区 → 送模 URL 列表（不拼 prompt） */
export function resolveQuickComposeImageQueues(
  input: Pick<
    ResolveQuickComposeRefsInput,
    'mainDropSlots' | 'referenceDropSlots' | 'dropSlots' | 'assets' | 'getAssetDisplayImage' | 'maxRefs'
  >
): QuickComposeImageQueuesResult {
  const warnings: string[] = [];
  const mainSlots = input.mainDropSlots ?? [];
  const refSlots = input.referenceDropSlots ?? [];
  let mainUrls = urlsFromDropSlots(mainSlots, input.assets, input.getAssetDisplayImage, warnings, '主图');
  let referenceUrls = urlsFromDropSlots(refSlots, input.assets, input.getAssetDisplayImage, warnings, '参考图');

  if (mainUrls.length === 0 && refSlots.length === 0 && (input.dropSlots?.length ?? 0) > 0) {
    mainUrls = urlsFromDropSlots(input.dropSlots ?? [], input.assets, input.getAssetDisplayImage, warnings, '图片');
    referenceUrls = [];
  }

  const maxRef = Math.max(1, input.maxRefs);
  const refCap = Math.max(0, maxRef - 1);
  if (referenceUrls.length > refCap) {
    warnings.push(`参考图超过上限（每条任务最多 ${refCap} 张），已截断`);
    referenceUrls = referenceUrls.slice(0, refCap);
  }

  return { mainUrls, referenceUrls, warnings };
}

/** 单条任务：主图=图1，参考区=图2…，拼 preset + 说明块 + 用户正文 */
export function buildQuickComposeTaskPromptOverride(
  userPrompt: string,
  mainImageUrl: string,
  referenceImageUrls: string[],
  maxRefs: number,
  presetInstruction?: string
): { primary: string; references: string[]; promptOverride: string } {
  const merged = mergePrimaryAndReferenceImageUrls(
    mainImageUrl,
    referenceImageUrls.slice(0, Math.max(0, maxRefs - 1))
  ).slice(0, maxRefs);
  if (merged.length === 0) {
    const promptOverride = buildQuickComposePromptOverride(userPrompt, '', presetInstruction);
    return { primary: '', references: [], promptOverride };
  }
  const primary = merged[0]!;
  const references = merged.slice(1);
  const referenceContextBlock = buildImageReferenceContextBlock(merged.length);
  const promptOverride = buildQuickComposePromptOverride(
    userPrompt,
    referenceContextBlock,
    presetInstruction
  );
  return { primary, references, promptOverride };
}

export function workflowAssetMentionLabel(asset: WorkflowAsset): string {
  const title = (asset.textTitle || '').trim();
  if (title) return title.length > 28 ? `${title.slice(0, 28)}…` : title;
  const gl = (asset.groupLabel || '').trim();
  if (gl) return gl.length > 28 ? `${gl.slice(0, 28)}…` : gl;
  return `图·${asset.id.slice(0, 8)}`;
}

/** @ 候选：主图区 + 参考图区合并为 图1、图2… */
export function mergeQuickComposeDropSlotsForMentions(
  mainDropSlots: QuickComposeDropSlot[],
  referenceDropSlots: QuickComposeDropSlot[]
): QuickComposeDropSlot[] {
  const out: QuickComposeDropSlot[] = [];
  for (let i = 0; i < mainDropSlots.length; i += 1) {
    out.push({ ...mainDropSlots[i]!, label: quickComposeImageMentionLabel(1) });
  }
  for (let i = 0; i < referenceDropSlots.length; i += 1) {
    out.push({
      ...referenceDropSlots[i]!,
      label: quickComposeImageMentionLabel(i + 2),
    });
  }
  return out;
}

/** @ 候选：已拖入主/参考区的资产 + 可选「当前画面」+ 专家 */
export function listDropSlotMentionCandidates(
  dropSlots: QuickComposeDropSlot[],
  mentions: QuickComposeMention[],
  options?: {
    includeCurrentView?: boolean;
    currentViewPreviewSrc?: string;
    mainDropSlots?: QuickComposeDropSlot[];
    referenceDropSlots?: QuickComposeDropSlot[];
    /** Extra candidates (e.g. experts) appended after image slots */
    extraCandidates?: QuickComposeMentionCandidate[];
  }
): QuickComposeMentionCandidate[] {
  const slots =
    (options?.mainDropSlots?.length ?? 0) > 0 || (options?.referenceDropSlots?.length ?? 0) > 0
      ? mergeQuickComposeDropSlotsForMentions(options?.mainDropSlots ?? [], options?.referenceDropSlots ?? [])
      : dropSlots;
  const mentionedIds = new Set(
    mentions.filter((m): m is Extract<QuickComposeMention, { kind: 'asset' }> => m.kind === 'asset').map((m) => m.assetId)
  );
  const mentionedExpertIds = new Set(
    mentions
      .filter((m): m is Extract<QuickComposeMention, { kind: 'expert' }> => m.kind === 'expert')
      .map((m) => m.expertId)
  );
  const out: QuickComposeMentionCandidate[] = [];
  if (options?.includeCurrentView && !mentions.some((m) => m.kind === 'current_view')) {
    out.push({
      kind: 'current_view',
      label: QUICK_COMPOSE_CURRENT_VIEW_LABEL,
      previewSrc: options.currentViewPreviewSrc,
    });
  }
  for (const s of slots) {
    if (mentionedIds.has(s.assetId)) continue;
    out.push({
      kind: 'asset',
      assetId: s.assetId,
      label: s.label,
      previewSrc: s.previewSrc,
    });
  }
  for (const c of options?.extraCandidates ?? []) {
    if (c.kind === 'expert') {
      const eid = (c.expertId || '').trim();
      if (!eid || mentionedExpertIds.has(eid)) continue;
      out.push(c);
      continue;
    }
    out.push(c);
  }
  return out;
}

/** Built-in expert @ candidates (kind:expert). */
export function listExpertMentionCandidates(
  mentions: QuickComposeMention[] = [],
  profiles?: Array<{ expertId: string; displayName: string }>
): QuickComposeMentionCandidate[] {
  const mentioned = new Set(
    mentions
      .filter((m): m is Extract<QuickComposeMention, { kind: 'expert' }> => m.kind === 'expert')
      .map((m) => m.expertId)
  );
  const list =
    profiles ??
    // Lazy import avoided — callers may pass listExpertProfiles(); fallback ids for pure tests.
    [
      { expertId: 'expert.prompt_smith', displayName: '提示词专家' },
      { expertId: 'expert.brief_outliner', displayName: '大纲分镜专家' },
    ];
  return list
    .filter((p) => p.expertId && !mentioned.has(p.expertId))
    .map((p) => ({
      kind: 'expert' as const,
      expertId: p.expertId,
      label: p.displayName,
    }));
}

export function listQuickComposeMentionCandidates(
  assets: WorkflowAsset[],
  options?: { includeCurrentView?: boolean; archivedVisible?: boolean }
): QuickComposeMentionCandidate[] {
  const out: QuickComposeMentionCandidate[] = [];
  const referencedPbrTextureIds = collectReferencedPbrTextureAssetIdsFromAssets(assets);
  if (options?.includeCurrentView) {
    out.push({ kind: 'current_view', label: QUICK_COMPOSE_CURRENT_VIEW_LABEL });
  }
  for (const a of assets) {
    if (a.archived && !options?.archivedVisible) continue;
    if (isWorkflowAssetHiddenFromAssetGrid(a, { referencedPbrTextureIds })) continue;
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
    const ordinal =
      existing.filter((m) => isQuickComposeImageMentionKind(m)).length + 1;
    return {
      id: `cv-${Date.now()}`,
      kind: 'current_view',
      label: quickComposeImageMentionLabel(ordinal),
      previewSrc: candidate.previewSrc,
    };
  }
  if (candidate.kind === 'expert') {
    const expertId = (candidate.expertId || '').trim();
    if (!expertId) return null;
    if (existing.some((m) => m.kind === 'expert' && m.expertId === expertId)) return null;
    return {
      id: `ex-${expertId}-${Date.now()}`,
      kind: 'expert',
      expertId,
      label: candidate.label || expertId,
      previewSrc: candidate.previewSrc,
    };
  }
  const assetId = (candidate.assetId || '').trim();
  if (!assetId) return null;
  if (existing.some((m) => m.kind === 'asset' && m.assetId === assetId)) return null;
  const ordinal =
    existing.filter((m) => isQuickComposeImageMentionKind(m)).length + 1;
  return {
    id: `a-${assetId}-${Date.now()}`,
    kind: 'asset',
    assetId,
    label: quickComposeImageMentionLabel(ordinal),
    previewSrc: candidate.previewSrc,
  };
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
  const start = match.index + match[0].length;
  let end: number | null = null;
  for (const other of all) {
    if (other.id === mention.id) continue;
    const oRe = new RegExp(`@${escapeRegExp(other.label)}`);
    const oMatch = oRe.exec(draft.slice(start));
    if (oMatch && oMatch.index >= 0) {
      const candidate = start + oMatch.index;
      if (end === null || candidate < end) end = candidate;
    }
  }
  /** 最后一个 @ 之后的正文属于 userPrompt，不再写入「说明」 */
  if (end === null) return '';
  return draft.slice(start, end).replace(/^\s+/, '').replace(/\s+$/, '');
}

function userPromptFromDraft(draft: string, mentions: QuickComposeMention[]): string {
  const ordered = orderMentionsForResolve(draft, mentions);
  let out = draft;
  for (const m of ordered) {
    const hint = segmentHintForMention(out, m, ordered);
    if (hint) {
      out = out.replace(
        new RegExp(`@${escapeRegExp(m.label)}\\s+${escapeRegExp(hint)}`),
        `@${m.label} `
      );
    }
    out = out.replace(new RegExp(`@${escapeRegExp(m.label)}\\s*`, 'g'), ' ');
  }
  return out.replace(/\s+/g, ' ').trim();
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
    if (s.type === 'mention') break;
    if (s.type === 'text') {
      if (isInterstitialHintTextSegment(segments, j)) return s.value.trim();
      break;
    }
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
  let imageContextIndex = 0;

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
        quickComposeImageContextLine(
          imageContextIndex,
          hint ? hint : imageContextIndex === 0 ? '' : '以提交时截取的画面为准。',
          m.kind
        )
      );
      imageContextIndex += 1;
      continue;
    }
    if (m.kind === 'expert') {
      // Expert mentions are routed by planTools; not image refs.
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
    refLines.push(quickComposeImageContextLine(imageContextIndex, hint, m.kind));
    imageContextIndex += 1;
  }

  const capped = refs.slice(0, Math.max(0, input.maxRefs));
  if (refs.length > capped.length) {
    warnings.push(`参考图超过上限（${input.maxRefs} 张），已截断`);
  }

  const userPrompt = userPromptFromSegments(segments);
  const referenceContextBlock = refLines.length > 0 ? refLines.join('\n') : '';

  return { refs: capped, userPrompt, referenceContextBlock, warnings };
}

export function resolveQuickComposeReferences(input: ResolveQuickComposeRefsInput): ResolveQuickComposeRefsResult {
  const segmentResult =
    input.segments && input.segments.length > 0
      ? resolveQuickComposeFromSegments(input.segments, input)
      : resolveQuickComposeReferencesFromDraft(input);

  const hasSplitQueues =
    (input.mainDropSlots?.length ?? 0) > 0 || (input.referenceDropSlots?.length ?? 0) > 0;
  if (hasSplitQueues) {
    return {
      refs: [],
      userPrompt: segmentResult.userPrompt,
      referenceContextBlock: '',
      warnings: segmentResult.warnings,
    };
  }

  const legacySlots = input.dropSlots ?? [];
  if (legacySlots.length > 0) {
    const queues = resolveQuickComposeImageQueues(input);
    const refs = mergePrimaryAndReferenceImageUrls(
      queues.mainUrls[0] ?? '',
      [...queues.mainUrls.slice(1), ...queues.referenceUrls]
    ).slice(0, input.maxRefs);
    return {
      refs,
      userPrompt: segmentResult.userPrompt,
      referenceContextBlock: buildImageReferenceContextBlock(refs.length),
      warnings: [...segmentResult.warnings, ...queues.warnings],
    };
  }

  return segmentResult;
}

function resolveQuickComposeReferencesFromDraft(
  input: ResolveQuickComposeRefsInput
): ResolveQuickComposeRefsResult {
  const draft = input.draft ?? '';
  const mentions = input.mentions ?? [];
  const warnings: string[] = [];
  const ordered = orderMentionsForResolve(draft, mentions);
  const refs: string[] = [];
  const refLines: string[] = [];
  const assetById = new Map(input.assets.map((a) => [a.id, a]));
  let imageContextIndex = 0;

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
        quickComposeImageContextLine(
          imageContextIndex,
          hint ? hint : imageContextIndex === 0 ? '' : '以提交时截取的画面为准。',
          m.kind
        )
      );
      imageContextIndex += 1;
      continue;
    }
    if (m.kind === 'expert') {
      // Expert mentions are routed by planTools; not image refs.
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
    refLines.push(quickComposeImageContextLine(imageContextIndex, hint, m.kind));
    imageContextIndex += 1;
  }

  const capped = refs.slice(0, Math.max(0, input.maxRefs));
  if (refs.length > capped.length) {
    warnings.push(`参考图超过上限（${input.maxRefs} 张），已截断`);
  }

  const userPrompt = userPromptFromDraft(draft, mentions);
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
