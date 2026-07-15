import React, { useEffect, useRef } from 'react';
import type {
  AgentSuggestedAction,
  QuickComposeChatMessageView,
  QuickComposeMessageAttachmentThumb,
} from '../../../types/quickComposeThread';
import {
  PROJECT_AGENT_EMPTY_HINT,
  PROJECT_AGENT_EMPTY_SUGGESTIONS,
  PROJECT_AGENT_EMPTY_TITLE,
} from './chatUiCopy';
import QuickComposeChatMessage from './QuickComposeChatMessage';

type QuickComposeTimelineTurn = {
  id: string;
  timestamp: number;
  user: QuickComposeChatMessageView | null;
  assistants: QuickComposeChatMessageView[];
};

function formatTurnTime(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(timestamp));
  } catch {
    return '';
  }
}

function compactPrompt(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t || '未命名请求';
}

function buildTimelineTurns(messages: QuickComposeChatMessageView[]): QuickComposeTimelineTurn[] {
  const turns: QuickComposeTimelineTurn[] = [];
  let current: QuickComposeTimelineTurn | null = null;

  messages.forEach((message, index) => {
    if (message.role === 'user') {
      current = {
        id: message.id,
        timestamp: message.timestamp,
        user: message,
        assistants: [],
      };
      turns.push(current);
      return;
    }

    if (!current) {
      current = {
        id: `assistant-turn:${message.id}`,
        timestamp: message.timestamp,
        user: null,
        assistants: [],
      };
      turns.push(current);
    }
    current.assistants.push({ ...message, id: message.id || `assistant:${index}` });
  });

  return turns.reverse();
}

function TimelineThumb({
  item,
}: {
  item: QuickComposeMessageAttachmentThumb;
}) {
  const src = String(item.previewSrc || '').trim();
  const canRenderImage = Boolean(src) && !/^javascript:/i.test(src) && !/^data:(?!image\/)/i.test(src);
  return canRenderImage ? (
    <img
      src={src}
      alt={item.label ?? '附件'}
      className="h-8 w-8 shrink-0 rounded-md object-cover ring-1 ring-white/[0.12]"
      draggable={false}
    />
  ) : (
    <span
      className="inline-grid h-8 w-8 shrink-0 place-items-center rounded-md bg-white/[0.06] text-[9px] font-bold text-gray-500 ring-1 ring-white/[0.1]"
      title={item.label}
    >
      @
    </span>
  );
}

function TimelineUserHeader({ message }: { message: QuickComposeChatMessageView | null }) {
  const attachments = message?.attachmentThumbs ?? [];
  const prompt = compactPrompt(message?.text ?? '');
  const timeLabel = formatTurnTime(message?.timestamp ?? 0);

  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.045] px-3 py-2.5">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <p className="min-w-0 whitespace-pre-wrap break-words text-[12px] font-semibold leading-relaxed text-gray-100">
          {prompt}
        </p>
        {timeLabel ? (
          <span className="shrink-0 pt-0.5 text-[9px] font-semibold text-gray-600">{timeLabel}</span>
        ) : null}
      </div>
      {attachments.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {attachments.map((item) => (
            <TimelineThumb key={item.id} item={item} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export type QuickComposeChatThreadProps = {
  key?: React.Key;
  messages: QuickComposeChatMessageView[];
  onRetryMessage?: (messageId: string) => void;
  onMessageAction?: (messageId: string, action: AgentSuggestedAction) => void;
  onCancelMessage?: (messageId: string) => void;
  onResultPreview?: (assetId: string, event: React.MouseEvent<HTMLElement>) => void;
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
  onResultPreview,
  emptyStateTitle = PROJECT_AGENT_EMPTY_TITLE,
  emptyStateHint = PROJECT_AGENT_EMPTY_HINT,
  emptyStateSuggestions = PROJECT_AGENT_EMPTY_SUGGESTIONS,
  onEmptySuggestionClick,
}: QuickComposeChatThreadProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastMessage = messages[messages.length - 1];
  const timelineTurns = buildTimelineTurns(messages);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (typeof el.scrollTo === 'function') {
      el.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      el.scrollTop = 0;
    }
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
        <div className="flex flex-col gap-3 px-3 py-3" data-agent-turn-timeline>
          {timelineTurns.map((turn, index) => (
            <section
              key={turn.id}
              className="relative pl-4"
              aria-label={turn.user ? compactPrompt(turn.user.text) : 'AI 结果'}
            >
              <div
                className={[
                  'pointer-events-none absolute left-[0.3125rem] top-3 w-px bg-white/[0.09]',
                  index === timelineTurns.length - 1 ? 'bottom-3' : '-bottom-4',
                ].join(' ')}
                aria-hidden
              />
              <span
                className="absolute left-0 top-3 h-2.5 w-2.5 rounded-full border border-blue-300/45 bg-[#111827] shadow-[0_0_0_3px_rgba(37,99,235,0.12)]"
                aria-hidden
              />
              <div className="flex min-w-0 flex-col gap-2">
                <TimelineUserHeader message={turn.user} />
                <div className="flex min-w-0 flex-col gap-2 pl-2">
                  {turn.assistants.length > 0 ? (
                    turn.assistants.map((msg) => (
                      <QuickComposeChatMessage
                        key={msg.id}
                        message={msg}
                        onRetry={onRetryMessage}
                        onAction={onMessageAction}
                        onCancel={onCancelMessage}
                        onResultPreview={onResultPreview}
                      />
                    ))
                  ) : (
                    <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-2 text-[11px] text-gray-500">
                      等待 AI 结果
                    </div>
                  )}
                </div>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
