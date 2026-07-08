import React, { useEffect, useRef } from 'react';
import type { QuickComposeChatMessageView } from '../../../types/quickComposeThread';
import QuickComposeChatMessage from './QuickComposeChatMessage';

export type QuickComposeChatThreadProps = {
  messages: QuickComposeChatMessageView[];
  onRetryMessage?: (messageId: string) => void;
  emptyStateTitle?: string;
  emptyStateHint?: string;
};

/**
 * Scrollable message thread with empty state and auto-scroll on new messages.
 */
export default function QuickComposeChatThread({
  messages,
  onRetryMessage,
  emptyStateTitle = '快捷生成',
  emptyStateHint = '在下方输入描述或 @ 引用资产，开始对话式生成。',
}: QuickComposeChatThreadProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastMessage = messages[messages.length - 1];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, lastMessage?.id, lastMessage?.status]);

  return (
    <div
      ref={scrollRef}
      className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain no-scrollbar"
      role="log"
      aria-live="polite"
      aria-relevant="additions"
    >
      {messages.length === 0 ? (
        <div className="flex h-full min-h-[12rem] flex-col items-center justify-center gap-2 px-6 text-center">
          <p className="text-[11px] font-black uppercase tracking-wide text-gray-500">{emptyStateTitle}</p>
          <p className="max-w-[16rem] text-[12px] leading-relaxed text-gray-600">{emptyStateHint}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3 px-3 py-3">
          {messages.map((msg) => (
            <QuickComposeChatMessage key={msg.id} message={msg} onRetry={onRetryMessage} />
          ))}
          <div ref={bottomRef} className="h-px shrink-0" aria-hidden />
        </div>
      )}
    </div>
  );
}
