import React, { useEffect, useRef } from 'react';
import type { QuickComposeChatMessageView } from '../../../types/quickComposeThread';
import {
  PROJECT_AGENT_EMPTY_HINT,
  PROJECT_AGENT_EMPTY_TITLE,
} from './chatUiCopy';
import QuickComposeChatMessage from './QuickComposeChatMessage';

export type QuickComposeChatThreadProps = {
  messages: QuickComposeChatMessageView[];
  onRetryMessage?: (messageId: string) => void;
  onCancelMessage?: (messageId: string) => void;
  emptyStateTitle?: string;
  emptyStateHint?: string;
};

/**
 * Scrollable message thread with empty state and auto-scroll on new messages.
 */
export default function QuickComposeChatThread({
  messages,
  onRetryMessage,
  onCancelMessage,
  emptyStateTitle = PROJECT_AGENT_EMPTY_TITLE,
  emptyStateHint = PROJECT_AGENT_EMPTY_HINT,
}: QuickComposeChatThreadProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastMessage = messages[messages.length - 1];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, lastMessage?.id, lastMessage?.status, lastMessage?.displayResultText]);

  return (
    <div
      ref={scrollRef}
      className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain no-scrollbar"
      role="log"
      aria-live="polite"
      aria-relevant="additions"
    >
      {messages.length === 0 ? (
        <div
          className="flex h-full min-h-[12rem] flex-col items-center justify-center gap-2.5 px-6 text-center"
          data-chat-empty-state
        >
          <p className="text-[11px] font-black uppercase tracking-wide text-gray-500">
            {emptyStateTitle}
          </p>
          <p className="max-w-[16rem] text-[12px] leading-relaxed text-gray-600">{emptyStateHint}</p>
          <p className="max-w-[16rem] text-[10px] leading-relaxed text-gray-700">
            试试描述想生成的画面，或输入 @ 点名专家
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5 px-3 py-3">
          {messages.map((msg) => (
            <QuickComposeChatMessage
              key={msg.id}
              message={msg}
              onRetry={onRetryMessage}
              onCancel={onCancelMessage}
            />
          ))}
          <div ref={bottomRef} className="h-px shrink-0" aria-hidden />
        </div>
      )}
    </div>
  );
}
