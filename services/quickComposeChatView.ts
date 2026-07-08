/**
 * 将持久化线程消息映射为聊天 UI 视图（缩略图由 assetId / taskId 运行时解析）。
 */

import type { WorkflowAsset, WorkflowPendingTask } from '../types';
import type {
  QuickComposeChatMessageView,
  QuickComposeMessageAttachmentThumb,
  QuickComposeThreadMessage,
} from '../types/quickComposeThread';
import type { QuickComposeDropSlot, QuickComposeSegment } from './quickComposeMention';
import { mentionsFromSegments } from './quickComposeMention';

export type QuickComposeChatViewContext = {
  assets: WorkflowAsset[];
  pending: WorkflowPendingTask[];
  executingQueue: { tasks: WorkflowPendingTask[] } | null;
  getAssetDisplayImage: (asset: WorkflowAsset) => string;
  getAssetLabel?: (asset: WorkflowAsset) => string;
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
    const task = findTaskById(taskId, ctx.pending, ctx.executingQueue);
    if (!task) continue;
    const asset = resolveAssetById(ctx.assets, task.assetId);
    if (!asset) continue;
    const thumb = assetThumb(asset, ctx.getAssetDisplayImage, ctx.getAssetLabel);
    if (thumb) return thumb;
  }
  return undefined;
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
  return {
    ...message,
    ...(attachmentThumbs ? { attachmentThumbs } : {}),
    ...(resultThumb ? { resultThumb } : {}),
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
