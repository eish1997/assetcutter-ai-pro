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
  /** taskId → 产出资产 id（持久化，便于任务出队后对齐错误态） */
  taskAssetById?: Record<string, string>;
  /**
   * 助手终态正文（文生文等）：计划句仍在 `text`，模型输出写这里。
   * 不存图片 base64。
   */
  resultText?: string;
  /** 助手消息处理状态（用户消息通常为 submitted） */
  status?: QuickComposeMessageStatus;
  timestamp: number;
  errorMessage?: string;
  /**
   * P0.5-d：计划步骤瘦快照（对齐 AgentTurnTrace.plan 的 label/toolId）。
   * 仅文案 id，无媒体字节；缺省时 UI 可从 `text` 计划句回退解析。
   */
  planSteps?: { label: string; toolId?: string }[];
  /**
   * U4 / P2：子 run 进度卡（agents-as-tools）。瘦快照，无媒体字节。
   * 类型见 `types/projectAgent.AgentChildRun`（运行时以结构兼容写入）。
   */
  childRuns?: Array<{
    id: string;
    kind: 'expert' | 'tool';
    label: string;
    expertId?: string;
    toolId?: string;
    status: 'queued' | 'running' | 'done' | 'error' | 'cancelled';
    taskIds?: string[];
    artifactIds?: string[];
    errorMessage?: string;
    startedAt: number;
    endedAt?: number;
  }>;
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
  /** 运行时解析的文生文结果（优先 message.resultText） */
  displayResultText?: string;
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
