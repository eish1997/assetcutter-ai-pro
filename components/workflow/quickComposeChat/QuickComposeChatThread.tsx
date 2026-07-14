import React, { useEffect, useRef } from 'react';
import type {
  AgentSuggestedAction,
  QuickComposeChatMessageView,
} from '../../../types/quickComposeThread';
import {
  PROJECT_AGENT_EMPTY_HINT,
  PROJECT_AGENT_EMPTY_SUGGESTIONS,
  PROJECT_AGENT_EMPTY_TITLE,
} from './chatUiCopy';
import QuickComposeChatMessage from './QuickComposeChatMessage';

export type QuickComposeChatThreadProps = {
  key?: React.Key;
  messages: QuickComposeChatMessageView[];
  onRetryMessage?: (messageId: string) => void;
  onMessageAction?: (messageId: string, action: AgentSuggestedAction) => void;
  onCancelMessage?: (messageId: string) => void;
  emptyStateTitle?: string;
  emptyStateHint?: string;
  emptyStateSuggestions?: string[];
  onEmptySuggestionClick?: (text: string) => void;
};

/**
 * Scrollable message thread with empty state and auto-scroll on new messages.
 */
export default function QuickComposeChatThread({
  messages,
  onRetryMessage,
  onMessageAction,
  onCancelMessage,
  emptyStateTitle = PROJECT_AGENT_EMPTY_TITLE,
  emptyStateHint = PROJECT_AGENT_EMPTY_HINT,
  emptyStateSuggestions = PROJECT_AGENT_EMPTY_SUGGESTIONS,
  onEmptySuggestionClick,
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
          className="flex h-full min-h-[12rem] flex-col items-stretch justify-center gap-3 px-5 py-5"
          data-chat-empty-state
        >
          <div className="text-center">
            <p className="text-[11px] font-black uppercase tracking-wide text-gray-500">
              {emptyStateTitle}
            </p>
            <p className="mx-auto mt-2 max-w-[17rem] text-[12px] leading-relaxed text-gray-600">{emptyStateHint}</p>
          </div>
          {emptyStateSuggestions.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              {emptyStateSuggestions.slice(0, 5).map((suggestion) =>
                onEmptySuggestionClick ? (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => onEmptySuggestionClick(suggestion)}
                    className="rounded-lg border border-white/[0.07] bg-white/[0.035] px-3 py-2 text-left text-[11px] leading-relaxed text-gray-400 outline-none transition-colors hover:border-white/[0.12] hover:bg-white/[0.07] hover:text-gray-100 focus-visible:ring-2 focus-visible:ring-blue-500/45"
                  >
                    {suggestion}
                  </button>
                ) : (
                  <div
                    key={suggestion}
                    className="rounded-lg border border-white/[0.05] bg-white/[0.025] px-3 py-2 text-left text-[11px] leading-relaxed text-gray-500"
                  >
                    {suggestion}
                  </div>
                )
              )}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5 px-3 py-3">
          {messages.map((msg) => (
            <QuickComposeChatMessage
              key={msg.id}
              message={msg}
              onRetry={onRetryMessage}
              onAction={onMessageAction}
              onCancel={onCancelMessage}
            />
          ))}
          <div ref={bottomRef} className="h-px shrink-0" aria-hidden />
        </div>
      )}
    </div>
  );
}
