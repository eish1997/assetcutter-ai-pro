import React, { useCallback, useMemo, useState } from 'react';
import { Minimize2 } from 'lucide-react';
import type { QuickComposeChatMessageView } from '../../../types/quickComposeThread';
import { ExpertStudio } from '../../project-agent/ExpertStudio';
import { WORKFLOW_QUICK_COMPOSE_DOCKED_WIDTH_CLASS } from '../workflowSectionUiConstants';
import {
  CLEAR_CHAT_BUSY_REASON,
  COMPOSER_BUSY_HINT,
  PROJECT_AGENT_EMPTY_HINT,
  PROJECT_AGENT_EMPTY_TITLE,
  isRunningAssistantStatus,
} from './chatUiCopy';
import QuickComposeChatComposer, { type QuickComposeChatComposerProps } from './QuickComposeChatComposer';
import QuickComposeChatThread from './QuickComposeChatThread';

export type QuickComposeChatDockExpertStudioKey = {
  userId: string;
  workspaceProjectId: string;
};

export type QuickComposeChatDockProps = {
  /** Header title (default: 快捷生成) */
  title?: string;
  /** Collapse / minimize sidebar */
  onMinimize?: () => void;
  /** P25：清空/新开对话（确认与归档由父级处理） */
  onClearChat?: () => void;
  /**
   * Phase 5C：加载更早（父级注入；Dock 不直接打 R2）。
   * 无更早时由 `canLoadEarlier=false` 禁用。
   */
  onLoadEarlier?: () => void;
  /** 是否有可加载的更早消息；默认 true（有回调即显示，由父级控制禁用） */
  canLoadEarlier?: boolean;
  /** Phase 5C：导出瘦 JSON（父级注入 browser download） */
  onExportChat?: () => void;
  /** Message thread (resolved view models with optional thumbs) */
  messages: QuickComposeChatMessageView[];
  onRetryMessage?: (messageId: string) => void;
  onCancelMessage?: (messageId: string) => void;
  threadEmptyTitle?: string;
  threadEmptyHint?: string;
  className?: string;
  /** Disable minimize button (e.g. while submitting) */
  minimizeDisabled?: boolean;
  /**
   * Phase 4C：提供时 header 显示「专家工作室」，叠层打开 ExpertStudio。
   * 不传则无入口（不影响发送）。
   */
  expertStudio?: QuickComposeChatDockExpertStudioKey | null;
  /** ExpertStudio 试跑：把产物文本写入 quick compose（由父级注入） */
  onTryRunPrompt?: (text: string) => void;
} & QuickComposeChatComposerProps;

/**
 * Gemini-style quick compose chat sidebar: header + scrollable thread + bottom composer.
 * Preset drops are handled by the parent strip (same as floating bar) when docked.
 */
export default function QuickComposeChatDock({
  title = '快捷生成',
  onMinimize,
  onClearChat,
  onLoadEarlier,
  canLoadEarlier = true,
  onExportChat,
  messages,
  onRetryMessage,
  onCancelMessage,
  threadEmptyTitle = PROJECT_AGENT_EMPTY_TITLE,
  threadEmptyHint = PROJECT_AGENT_EMPTY_HINT,
  className = '',
  minimizeDisabled = false,
  expertStudio = null,
  onTryRunPrompt,
  ...composerProps
}: QuickComposeChatDockProps) {
  const [expertStudioOpen, setExpertStudioOpen] = useState(false);

  const threadBusy = useMemo(
    () =>
      messages.some(
        (m) => m.role === 'assistant' && isRunningAssistantStatus(m.status)
      ),
    [messages]
  );

  // 与悬浮条 MentionField 相同：仅 bubble 阶段转发，不在 capture 抢事件
  const handleDockDragOver = useCallback(
    (e: React.DragEvent) => {
      composerProps.onComposeInputDragOver?.(e);
    },
    [composerProps.onComposeInputDragOver]
  );
  const handleDockDrop = useCallback(
    (e: React.DragEvent) => {
      composerProps.onComposeInputDrop?.(e, 'main');
    },
    [composerProps.onComposeInputDrop]
  );

  const canOpenExpertStudio = Boolean(
    expertStudio?.userId && expertStudio?.workspaceProjectId
  );

  return (
    <aside
      className={`relative isolate z-[20] flex h-full min-h-0 flex-col self-stretch overflow-hidden border-l border-white/[0.08] bg-[#0f0f12] pointer-events-auto ${WORKFLOW_QUICK_COMPOSE_DOCKED_WIDTH_CLASS} ${className}`}
      data-workflow-quick-compose-chat-dock
      data-ac-block-workflow-marquee
      aria-label={title}
      onDragOver={handleDockDragOver}
      onDrop={handleDockDrop}
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-white/[0.06] bg-[#0f0f12] px-3 py-2.5">
        <h2 className="min-w-0 truncate text-[11px] font-black tracking-wide text-gray-300">
          {title}
        </h2>
        <div className="flex shrink-0 items-center gap-0.5">
          {canOpenExpertStudio ? (
            <button
              type="button"
              onClick={() => setExpertStudioOpen(true)}
              className="rounded-md px-2 py-1.5 text-[10px] font-medium text-gray-400 outline-none transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-blue-500/50"
              title="专家工作室"
              aria-label="专家工作室"
            >
              专家工作室
            </button>
          ) : null}
          {onLoadEarlier ? (
            <button
              type="button"
              disabled={threadBusy || !canLoadEarlier}
              onClick={onLoadEarlier}
              className="rounded-md px-2 py-1.5 text-[10px] font-medium text-gray-400 outline-none transition-colors hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-35 focus-visible:ring-2 focus-visible:ring-blue-500/50"
              title={
                !canLoadEarlier
                  ? '没有更早的消息'
                  : threadBusy
                    ? CLEAR_CHAT_BUSY_REASON
                    : '加载更早'
              }
              aria-label={
                !canLoadEarlier
                  ? '没有更早的消息'
                  : threadBusy
                    ? CLEAR_CHAT_BUSY_REASON
                    : '加载更早'
              }
            >
              加载更早
            </button>
          ) : null}
          {onExportChat ? (
            <button
              type="button"
              onClick={onExportChat}
              className="rounded-md px-2 py-1.5 text-[10px] font-medium text-gray-400 outline-none transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-blue-500/50"
              title="导出对话"
              aria-label="导出对话"
            >
              导出对话
            </button>
          ) : null}
          {onClearChat ? (
            <button
              type="button"
              disabled={threadBusy}
              onClick={onClearChat}
              className="rounded-md px-2 py-1.5 text-[10px] font-medium text-gray-400 outline-none transition-colors hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-35 focus-visible:ring-2 focus-visible:ring-blue-500/50"
              title={threadBusy ? CLEAR_CHAT_BUSY_REASON : '清空对话'}
              aria-label={threadBusy ? CLEAR_CHAT_BUSY_REASON : '清空对话'}
            >
              清空对话
            </button>
          ) : null}
          {onMinimize ? (
            <button
              type="button"
              disabled={minimizeDisabled}
              onClick={onMinimize}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-gray-400 outline-none transition-colors hover:bg-white/[0.08] hover:text-white disabled:opacity-35 focus-visible:ring-2 focus-visible:ring-blue-500/50"
              title="收起侧栏"
              aria-label="收起侧栏"
            >
              <Minimize2 className="h-4 w-4" strokeWidth={2.2} aria-hidden />
            </button>
          ) : null}
        </div>
      </header>

      <QuickComposeChatThread
        messages={messages}
        onRetryMessage={onRetryMessage}
        onCancelMessage={onCancelMessage}
        emptyStateTitle={threadEmptyTitle}
        emptyStateHint={threadEmptyHint}
      />

      <QuickComposeChatComposer
        {...composerProps}
        threadBusy={threadBusy}
        threadBusyHint={COMPOSER_BUSY_HINT}
      />

      {expertStudioOpen && canOpenExpertStudio && expertStudio ? (
        <div
          className="absolute inset-0 z-[30] flex flex-col bg-[#0f0f12]/90 backdrop-blur-[2px]"
          data-expert-studio-overlay
          role="dialog"
          aria-modal="true"
          aria-label="专家工作室"
        >
          <ExpertStudio
            userId={expertStudio.userId}
            workspaceProjectId={expertStudio.workspaceProjectId}
            onClose={() => setExpertStudioOpen(false)}
            onTryRunPrompt={onTryRunPrompt}
          />
        </div>
      ) : null}
    </aside>
  );
}

export type { QuickComposeChatComposerProps };
