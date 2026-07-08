import React from 'react';
import { Minimize2 } from 'lucide-react';
import type { QuickComposeChatMessageView } from '../../../types/quickComposeThread';
import { WORKFLOW_QUICK_COMPOSE_DOCKED_WIDTH_CLASS } from '../workflowSectionUiConstants';
import QuickComposeChatComposer, { type QuickComposeChatComposerProps } from './QuickComposeChatComposer';
import QuickComposeChatThread from './QuickComposeChatThread';

export type QuickComposeChatDockProps = {
  /** Header title (default: 快捷生成) */
  title?: string;
  /** Collapse / minimize sidebar */
  onMinimize?: () => void;
  /** Message thread (resolved view models with optional thumbs) */
  messages: QuickComposeChatMessageView[];
  onRetryMessage?: (messageId: string) => void;
  threadEmptyTitle?: string;
  threadEmptyHint?: string;
  className?: string;
  /** Disable minimize button (e.g. while submitting) */
  minimizeDisabled?: boolean;
} & QuickComposeChatComposerProps;

/**
 * Gemini-style quick compose chat sidebar: header + scrollable thread + bottom composer.
 * Designed for WorkflowSection / App dock host integration (not wired yet).
 */
export default function QuickComposeChatDock({
  title = '快捷生成',
  onMinimize,
  messages,
  onRetryMessage,
  threadEmptyTitle,
  threadEmptyHint,
  className = '',
  minimizeDisabled = false,
  ...composerProps
}: QuickComposeChatDockProps) {
  return (
    <aside
      className={`relative isolate z-[20] flex h-full min-h-0 flex-col self-stretch overflow-hidden border-l border-white/[0.08] bg-[#0f0f12] pointer-events-auto ${WORKFLOW_QUICK_COMPOSE_DOCKED_WIDTH_CLASS} ${className}`}
      data-workflow-quick-compose-chat-dock
      data-ac-block-workflow-marquee
      aria-label={title}
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-white/[0.06] px-3 py-2.5">
        <h2 className="min-w-0 truncate text-[10px] font-black uppercase tracking-wide text-gray-400">
          {title}
        </h2>
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
      </header>

      <QuickComposeChatThread
        messages={messages}
        onRetryMessage={onRetryMessage}
        emptyStateTitle={threadEmptyTitle}
        emptyStateHint={threadEmptyHint}
      />

      <QuickComposeChatComposer {...composerProps} />
    </aside>
  );
}

export type { QuickComposeChatComposerProps };
