/**
 * 将持久化线程消息映射为聊天 UI 视图（缩略图由 assetId / taskId 运行时解析）。
 */

import type { WorkflowAsset, WorkflowPendingTask } from '../types';
import type {
  AgentResultCardView,
  AgentSuggestedAction,
  QuickComposeChatMessageView,
  QuickComposeMessageAttachmentThumb,
  QuickComposeThreadMessage,
} from '../types/quickComposeThread';
import type { QuickComposeDropSlot, QuickComposeSegment } from './quickComposeMention';
import { mentionsFromSegments } from './quickComposeMention';
import { resolveWorkflowAssetLatestTextResult } from './quickComposeTurnContext';

export type QuickComposeChatViewContext = {
  assets: WorkflowAsset[];
  pending: WorkflowPendingTask[];
  executingQueue: { tasks: WorkflowPendingTask[] } | null;
  getAssetDisplayImage: (asset: WorkflowAsset) => string;
  getAssetLabel?: (asset: WorkflowAsset) => string;
  selectedAssetIds?: string[];
};

function findTaskById(
  taskId: string,
  pending: WorkflowPendingTask[],
  executingQueue: { tasks: WorkflowPendingTask[] } | null
): WorkflowPendingTask | null {
  return pending.find((t) => t.id === taskId) ?? executingQueue?.tasks.find((t) => t.id === taskId) ?? null;
}

function assetThumb(
  asset: WorkflowAsset,
  getAssetDisplayImage: (asset: WorkflowAsset) => string,
  getAssetLabel?: (asset: WorkflowAsset) => string
): QuickComposeMessageAttachmentThumb | null {
  const previewSrc = getAssetDisplayImage(asset).trim();
  if (!previewSrc) return null;
  return {
    id: asset.id,
    previewSrc,
    ...(getAssetLabel ? { label: getAssetLabel(asset) } : {}),
  };
}

function resolveAssetById(assets: WorkflowAsset[], assetId: string): WorkflowAsset | null {
  const id = assetId.trim();
  if (!id) return null;
  return assets.find((a) => a.id === id) ?? null;
}

function resolveResultThumb(
  message: QuickComposeThreadMessage,
  ctx: QuickComposeChatViewContext
): QuickComposeMessageAttachmentThumb | undefined {
  if (message.role !== 'assistant' || message.status !== 'done' || !message.taskIds?.length) {
    return undefined;
  }
  for (const taskId of message.taskIds) {
    const mappedId = message.taskAssetById?.[taskId];
    const task = findTaskById(taskId, ctx.pending, ctx.executingQueue);
    const assetId = (mappedId || task?.assetId || '').trim();
    if (!assetId) continue;
    const asset = resolveAssetById(ctx.assets, assetId);
    if (!asset) continue;
    // 文生文结果走 displayResultText，不在此塞图缩略
    if (asset.assetKind === 'text' || resolveWorkflowAssetLatestTextResult(asset)) continue;
    const thumb = assetThumb(asset, ctx.getAssetDisplayImage, ctx.getAssetLabel);
    if (thumb) return thumb;
  }
  return undefined;
}

function resolveDisplayResultText(
  message: QuickComposeThreadMessage,
  ctx: QuickComposeChatViewContext
): string | undefined {
  if (message.role !== 'assistant' || message.status !== 'done') return undefined;
  const stored = typeof message.resultText === 'string' ? message.resultText.trim() : '';
  if (stored) return stored;
  if (!message.taskIds?.length) return undefined;
  for (const taskId of message.taskIds) {
    const mappedId = message.taskAssetById?.[taskId];
    const task = findTaskById(taskId, ctx.pending, ctx.executingQueue);
    const assetId = (mappedId || task?.assetId || '').trim();
    if (!assetId) continue;
    const text = resolveWorkflowAssetLatestTextResult(resolveAssetById(ctx.assets, assetId));
    if (text) return text;
  }
  return undefined;
}

function action(
  id: string,
  label: string,
  kind: AgentSuggestedAction['kind'],
  payload?: Record<string, unknown>
): AgentSuggestedAction {
  return {
    id,
    label,
    kind,
    confirmLevel: kind === 'retry' || kind === 'preview' ? 'light' : 'none',
    ...(payload ? { payload } : {}),
  };
}

export function deriveQuickComposeSuggestedActions(
  message: QuickComposeThreadMessage,
  opts: {
    hasResultThumb?: boolean;
    hasResultText?: boolean;
    selectedAssetCount?: number;
  } = {}
): AgentSuggestedAction[] {
  if (message.role !== 'assistant') return [];
  if (message.status === 'error') {
    return [
      action('retry', '重试', 'retry', { messageId: message.id }),
      action('try_another_way', '换个方式', 'reply', {
        text: '换一种更稳妥的方式重新处理这个需求',
      }),
      action('view_details', '查看详情', 'open_panel', { messageId: message.id }),
    ];
  }
  if (message.status === 'done') {
    const hasResult = Boolean(opts.hasResultThumb || opts.hasResultText || message.taskIds?.length);
    if (!hasResult) return [];
    const actions: AgentSuggestedAction[] = [
      action('continue_refine', '继续优化', 'reply', { text: '基于这次结果继续优化细节' }),
      action('try_variant', '试一版变化', 'reply', { text: '保持方向不变，再生成一个差异化版本' }),
      action('view_details', '查看详情', 'open_panel', { messageId: message.id }),
    ];
    actions.splice(2, 0, {
      id: 'save_memory',
      label: '保存这次风格/流程/偏好',
      kind: 'save_memory',
      confirmLevel: 'light',
      payload: {
        messageId: message.id,
        memoryKind: opts.hasResultThumb ? 'workflow_success' : 'preference',
        panel: 'memory',
        summary: opts.hasResultThumb
          ? '把这次有效的风格和处理流程保存为后续可参考的记忆'
          : '把这次偏好保存为后续回复可参考的记忆',
      },
    });
    if (opts.hasResultThumb) {
      actions.splice(3, 0, {
        id: 'use_as_reference',
        label: '作为参考',
        kind: 'reply',
        confirmLevel: 'none',
        payload: { text: '把这次结果作为参考，继续生成新的方案' },
      });
      if ((opts.selectedAssetCount ?? 0) > 0) {
        actions.splice(3, 0, {
          id: 'apply_to_selected',
          label: `应用到选中(${opts.selectedAssetCount})`,
          kind: 'apply',
          confirmLevel: 'cost',
          targetScope: 'selected',
          costHint: { estimatedItems: opts.selectedAssetCount },
          payload: {
            messageId: message.id,
            text: `把这次结果的风格和处理方式应用到当前选中的 ${opts.selectedAssetCount} 个素材`,
          },
        });
      }
      actions.push({
        id: 'save_as_preset',
        label: '存为预设',
        kind: 'save_preset',
        confirmLevel: 'light',
        payload: {
          messageId: message.id,
          text: '把这次处理方式整理成一个可复用预设',
        },
      });
    }
    return actions;
  }
  return [];
}

function buildResultCard(
  message: QuickComposeThreadMessage,
  actions: AgentSuggestedAction[],
  opts: {
    resultThumb?: QuickComposeMessageAttachmentThumb;
    displayResultText?: string;
  }
): AgentResultCardView | undefined {
  if (message.role !== 'assistant') return undefined;
  if (message.status === 'error') {
    return {
      id: `${message.id}:error`,
      kind: 'error',
      title: '处理失败',
      status: 'failed',
      taskIds: message.taskIds,
      summary: message.errorMessage?.trim() || '这次没有完成，可以重试或换个说法',
      actions,
    };
  }
  if (message.status !== 'done') return undefined;
  const hasImage = Boolean(opts.resultThumb);
  const hasText = Boolean(opts.displayResultText?.trim());
  if (!hasImage && !hasText && !message.taskIds?.length) return undefined;
  return {
    id: `${message.id}:result`,
    kind: hasImage ? 'image' : hasText ? 'text' : 'batch',
    title: hasImage ? '生成结果' : hasText ? '文本结果' : '任务结果',
    status: 'final',
    assetIds: opts.resultThumb ? [opts.resultThumb.id] : undefined,
    taskIds: message.taskIds,
    summary: opts.displayResultText?.trim(),
    actions,
  };
}

function resolveAttachmentThumbs(
  message: QuickComposeThreadMessage,
  ctx: QuickComposeChatViewContext
): QuickComposeMessageAttachmentThumb[] | undefined {
  if (message.role !== 'user' || !message.assetIds?.length) return undefined;
  const thumbs: QuickComposeMessageAttachmentThumb[] = [];
  for (const assetId of message.assetIds) {
    const asset = resolveAssetById(ctx.assets, assetId);
    if (!asset) continue;
    const thumb = assetThumb(asset, ctx.getAssetDisplayImage, ctx.getAssetLabel);
    if (thumb) thumbs.push(thumb);
  }
  return thumbs.length > 0 ? thumbs : undefined;
}

export function mapQuickComposeThreadMessageToChatView(
  message: QuickComposeThreadMessage,
  ctx: QuickComposeChatViewContext
): QuickComposeChatMessageView {
  const attachmentThumbs = resolveAttachmentThumbs(message, ctx);
  const resultThumb = resolveResultThumb(message, ctx);
  const displayResultText = resolveDisplayResultText(message, ctx);
  const suggestedActions = deriveQuickComposeSuggestedActions(message, {
    hasResultThumb: Boolean(resultThumb),
    hasResultText: Boolean(displayResultText),
    selectedAssetCount: ctx.selectedAssetIds?.length ?? 0,
  });
  const resultCard = buildResultCard(message, suggestedActions, {
    ...(resultThumb ? { resultThumb } : {}),
    ...(displayResultText ? { displayResultText } : {}),
  });
  return {
    ...message,
    ...(attachmentThumbs ? { attachmentThumbs } : {}),
    ...(resultThumb ? { resultThumb } : {}),
    ...(displayResultText ? { displayResultText } : {}),
    ...(suggestedActions.length ? { suggestedActions } : {}),
    ...(resultCard ? { resultCard } : {}),
  };
}

export function mapQuickComposeThreadMessagesToChatViews(
  messages: QuickComposeThreadMessage[],
  ctx: QuickComposeChatViewContext
): QuickComposeChatMessageView[] {
  return messages.map((m) => mapQuickComposeThreadMessageToChatView(m, ctx));
}

/** 发送时收集用户消息附带的资产 id（拖入区 + @ 引用）。 */
export function collectQuickComposeAttachmentAssetIds(args: {
  segments: QuickComposeSegment[];
  mainDropSlots: QuickComposeDropSlot[];
  referenceDropSlots: QuickComposeDropSlot[];
  lightboxAssetId?: string | null;
}): string[] {
  const ids = new Set<string>();
  for (const slot of args.mainDropSlots) {
    const id = String(slot.assetId ?? '').trim();
    if (id) ids.add(id);
  }
  for (const slot of args.referenceDropSlots) {
    const id = String(slot.assetId ?? '').trim();
    if (id) ids.add(id);
  }
  for (const mention of mentionsFromSegments(args.segments)) {
    if (mention.kind === 'asset') {
      const id = String(mention.assetId ?? '').trim();
      if (id) ids.add(id);
    }
    if (mention.kind === 'current_view') {
      const id = String(args.lightboxAssetId ?? '').trim();
      if (id) ids.add(id);
    }
  }
  return [...ids];
}
