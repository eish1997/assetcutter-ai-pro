import React, { useMemo } from 'react';
import { RotateCcw } from 'lucide-react';
import type {
  QuickComposeChatMessageView,
  QuickComposeMessageAttachmentThumb,
} from '../../../types/quickComposeThread';
import { deriveAssistantTimeline } from '../../../services/projectAgent/assistantTimeline';
import { QUICK_COMPOSE_CANCELLED_MESSAGE } from '../../../services/quickComposeTurnContext';
import { WORKFLOW_QUICK_COMPOSE_BAR_SHELL } from '../workflowSectionUiConstants';
import {
  ERROR_FALLBACK,
  isRunningAssistantStatus,
} from './chatUiCopy';
import AssistantMarkdown from './AssistantMarkdown';
import AssistantTurnTimeline from './AssistantTurnTimeline';
import ChildRunProgressCards from './ChildRunProgressCards';
import type { AgentChildRun } from '../../../types/projectAgent';

export type QuickComposeChatMessageProps = {
  message: QuickComposeChatMessageView;
  onRetry?: (messageId: string) => void;
  /** §16.1 / 3A：取消进行中的助手 turn */
  onCancel?: (messageId: string) => void;
};

function ChatThumb({
  item,
  size = 56,
  className = '',
}: {
  item: QuickComposeMessageAttachmentThumb;
  size?: number;
  className?: string;
}) {
  const box = `inline-block shrink-0 overflow-hidden rounded-lg ring-1 ring-white/[0.12] ${className}`;
  const src = item.previewSrc;
  if (src && (src.startsWith('data:image/') || src.startsWith('blob:') || /^https?:\/\//i.test(src))) {
    return (
      <img
        src={src}
        alt={item.label ?? '附件'}
        className={`${box} object-cover`}
        style={{ width: size, height: size }}
        draggable={false}
      />
    );
  }
  return (
    <span
      className={`${box} inline-grid place-items-center bg-white/[0.06] text-[9px] font-bold text-gray-500`}
      style={{ width: size, height: size }}
      title={item.label}
    >
      @
    </span>
  );
}

function AttachmentThumbRow({ items }: { items: QuickComposeMessageAttachmentThumb[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <ChatThumb key={item.id} item={item} size={52} />
      ))}
    </div>
  );
}

function looksLikePlanLine(text: string): boolean {
  return /^计划[：:]/.test(text.trim());
}

/**
 * Gemini-style chat bubble for quick compose sidebar (user / assistant).
 * Done turns prefer result body; plan stays as light meta (ChatGPT/Gemini-like continuity).
 */
export default function QuickComposeChatMessage({
  message,
  onRetry,
  onCancel,
}: QuickComposeChatMessageProps) {
  const isUser = message.role === 'user';
  const isRunning = message.role === 'assistant' && isRunningAssistantStatus(message.status);
  const isError = message.status === 'error';
  const isDone = message.status === 'done';
  const planOrText = message.text?.trim() || '';
  const resultBody = message.displayResultText?.trim() || '';
  const attachments = message.attachmentThumbs ?? [];
  const isCancelled =
    isError && (message.errorMessage || '').trim() === QUICK_COMPOSE_CANCELLED_MESSAGE;

  const timeline = useMemo(() => deriveAssistantTimeline(message), [message]);

  const showResultAsPrimary = Boolean(isDone && resultBody);
  const showPlanAsMeta =
    Boolean(planOrText) &&
    (showResultAsPrimary || isRunning || (isDone && message.resultThumb && looksLikePlanLine(planOrText)));
  const showPlainText =
    Boolean(planOrText) &&
    !showResultAsPrimary &&
    !(isDone && message.resultThumb && looksLikePlanLine(planOrText)) &&
    // P0.5-d：有时间线时计划句改由时间线步骤展示，避免重复
    !(timeline && looksLikePlanLine(planOrText));

  const bubbleShell = isUser
    ? 'rounded-2xl rounded-br-md bg-blue-600/20 text-gray-100 ring-1 ring-blue-400/25'
    : `${WORKFLOW_QUICK_COMPOSE_BAR_SHELL} rounded-2xl rounded-bl-md text-gray-100`;

  return (
    <div className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex max-w-[min(100%,22rem)] min-w-0 flex-col gap-1.5 px-3 py-2.5 ${bubbleShell}`}>
        {attachments.length > 0 ? <AttachmentThumbRow items={attachments} /> : null}

        {showPlanAsMeta ? (
          <p className="text-[10px] font-medium leading-snug text-gray-500">{planOrText}</p>
        ) : null}

        {showResultAsPrimary ? <AssistantMarkdown text={resultBody} /> : null}

        {showPlainText ? (
          isUser ? (
            <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">{planOrText}</p>
          ) : (
            <AssistantMarkdown text={planOrText} />
          )
        ) : null}

        {timeline && !isUser ? (
          <AssistantTurnTimeline
            model={timeline}
            compact={!isRunning}
            onCancel={isRunning && onCancel ? () => onCancel(message.id) : undefined}
          />
        ) : null}

        {!isUser && message.childRuns?.length ? (
          <ChildRunProgressCards
            childRuns={message.childRuns as AgentChildRun[]}
            compact={!isRunning}
          />
        ) : null}

        {isDone && message.resultThumb ? (
          <div className="flex flex-col gap-1.5 pt-0.5">
            <ChatThumb item={message.resultThumb} size={140} className="rounded-xl" />
          </div>
        ) : null}

        {isError ? (
          <div className="flex flex-col gap-2 pt-0.5">
            <p
              className={`text-[11px] leading-snug ${
                isCancelled ? 'text-gray-400' : 'text-red-300/95'
              }`}
            >
              {isCancelled
                ? QUICK_COMPOSE_CANCELLED_MESSAGE
                : message.errorMessage?.trim() || ERROR_FALLBACK}
            </p>
            {!isCancelled && onRetry ? (
              <button
                type="button"
                onClick={() => onRetry(message.id)}
                className="inline-flex w-fit items-center gap-1.5 rounded-md bg-white/[0.08] px-2 py-1 text-[10px] font-semibold text-gray-200 ring-1 ring-white/[0.1] outline-none transition-colors hover:bg-white/[0.12] focus-visible:ring-2 focus-visible:ring-blue-500/45"
              >
                <RotateCcw className="h-3 w-3" strokeWidth={2.2} aria-hidden />
                重试
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
