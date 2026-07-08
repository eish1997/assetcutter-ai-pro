/** Gemini 风格底部快捷栏对话线程 — 工作区 / 大图各一条。 */

export type QuickComposeThreadScope = 'workspace' | 'lightbox';

export type QuickComposeMessageStatus =
  | 'submitted'
  | 'queued'
  | 'understanding'
  | 'running'
  | 'done'
  | 'error';

export type QuickComposeThreadMessageRole = 'user' | 'assistant';

/** 线程内单条消息：仅引用 assetId / taskId，不存 base64。 */
export type QuickComposeThreadMessage = {
  id: string;
  role: QuickComposeThreadMessageRole;
  text: string;
  /** 本轮引用的工作流资产 id */
  assetIds?: string[];
  /** 关联的 pending / 任务 id */
  taskIds?: string[];
  /** 助手消息处理状态（用户消息通常为 submitted） */
  status?: QuickComposeMessageStatus;
  timestamp: number;
  errorMessage?: string;
};

/** @deprecated Prefer `QuickComposeThreadMessage`; kept for WorkflowSection / chat UI imports. */
export type QuickComposeMessage = QuickComposeThreadMessage;

/** Alias for chat bubble components (`QuickComposeChatMessage.tsx`). */
export type QuickComposeChatMessage = QuickComposeThreadMessage;

/** UI 渲染用附件缩略图（父级由 assetId 解析 previewSrc）。 */
export type QuickComposeMessageAttachmentThumb = {
  id: string;
  previewSrc: string;
  label?: string;
};

/** 聊天 UI 视图：线程消息 + 已解析缩略图（不写入持久化）。 */
export type QuickComposeChatMessageView = QuickComposeThreadMessage & {
  attachmentThumbs?: QuickComposeMessageAttachmentThumb[];
  resultThumb?: QuickComposeMessageAttachmentThumb;
};

export type QuickComposeThread = {
  id: string;
  scope: QuickComposeThreadScope;
  workspaceProjectId: string;
  /** 仅 scope=lightbox：如 `${assetId}:${displayKey}` */
  lightboxSessionKey?: string;
  messages: QuickComposeThreadMessage[];
  createdAt: number;
  updatedAt: number;
};
