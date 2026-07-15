import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';
import type {
  AgentResultCardView,
  AgentSuggestedAction,
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
  key?: React.Key;
  message: QuickComposeChatMessageView;
  onRetry?: (messageId: string) => void;
  onAction?: (messageId: string, action: AgentSuggestedAction) => void;
  /** §16.1 / 3A：取消进行中的助手 turn */
  onCancel?: (messageId: string) => void;
  onResultPreview?: (assetId: string, event: React.MouseEvent<HTMLElement>) => void;
};

function ChatThumb({
  item,
  size = 56,
  className = '',
  onClick,
}: {
  key?: React.Key;
  item: QuickComposeMessageAttachmentThumb;
  size?: number;
  className?: string;
  onClick?: (event: React.MouseEvent<HTMLElement>) => void;
}) {
  const box = `inline-block shrink-0 overflow-hidden rounded-lg ring-1 ring-white/[0.12] ${className}`;
  const src = item.previewSrc;
  const trimmedSrc = String(src || '').trim();
  const canRenderImage =
    Boolean(trimmedSrc) &&
    !/^javascript:/i.test(trimmedSrc) &&
    !/^data:(?!image\/)/i.test(trimmedSrc);
  const content = canRenderImage ? (
    <img
      src={trimmedSrc}
      alt={item.label ?? '附件'}
      className={`${box} object-cover`}
      style={{ width: size, height: size }}
      draggable={false}
    />
  ) : (
    <span
      className={`${box} inline-grid place-items-center bg-white/[0.06] text-[9px] font-bold text-gray-500`}
      style={{ width: size, height: size }}
      title={item.label}
    >
      @
    </span>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="inline-flex w-fit shrink-0 rounded-xl text-left outline-none transition-transform hover:scale-[1.015] focus-visible:ring-2 focus-visible:ring-blue-500/45"
        title={item.label ? `预览 ${item.label}` : '预览结果'}
        aria-label={item.label ? `预览 ${item.label}` : '预览结果'}
        data-agent-result-preview-trigger
      >
        {content}
      </button>
    );
  }
  return content;
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

function ResultStatusCard({ card }: { card: AgentResultCardView }) {
  if (card.kind === 'error') return null;
  const assetCount = card.assetIds?.length ?? 0;
  const taskCount = card.taskIds?.length ?? 0;
  return (
    <div
      className="rounded-xl border border-emerald-300/15 bg-emerald-300/[0.055] px-2.5 py-2"
      data-agent-result-card
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <p className="min-w-0 truncate text-[11px] font-semibold text-emerald-50/90">
          {card.title}
        </p>
        {assetCount > 0 ? (
          <span className="shrink-0 rounded-full border border-emerald-200/15 bg-emerald-200/[0.08] px-1.5 py-0.5 text-[9px] font-semibold text-emerald-50/75">
            {assetCount} 资产
          </span>
        ) : taskCount > 0 ? (
          <span className="shrink-0 rounded-full border border-white/[0.08] bg-white/[0.05] px-1.5 py-0.5 text-[9px] font-semibold text-gray-300">
            {taskCount} 任务
          </span>
        ) : null}
      </div>
      {card.summary ? (
        <p className="mt-1 text-[10px] leading-4 text-emerald-50/60">{card.summary}</p>
      ) : null}
    </div>
  );
}

/**
 * Gemini-style chat bubble for quick compose sidebar (user / assistant).
 * Done turns prefer result body; plan stays as light meta (ChatGPT/Gemini-like continuity).
 */
export default function QuickComposeChatMessage({
  message,
  onRetry,
  onAction,
  onCancel,
  onResultPreview,
}: QuickComposeChatMessageProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const isUser = message.role === 'user';
  const isRunning = message.role === 'assistant' && isRunningAssistantStatus(message.status);
  const isError = message.status === 'error';
  const isDone = message.status === 'done';
  const planOrText = message.text?.trim() || '';
  const resultBody = message.displayResultText?.trim() || '';
  const attachments = message.attachmentThumbs ?? [];
  const suggestedActions = message.suggestedActions ?? [];
  const resultCard = message.resultCard;
  const retryAction = suggestedActions.find((a) => a.kind === 'retry');
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

  const hasTimelineDetails = Boolean(timeline && !isUser && (isRunning || isError));
  const hasDetails = Boolean(hasTimelineDetails || (!isUser && message.childRuns?.length));
  const showDetails = isRunning || detailsOpen;

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

        {!isUser && isDone && resultCard ? <ResultStatusCard card={resultCard} /> : null}

        {!isUser && hasDetails && !isRunning ? (
          <button
            type="button"
            onClick={() => setDetailsOpen((v) => !v)}
            className="inline-flex w-fit items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-gray-500 outline-none transition-colors hover:bg-white/[0.06] hover:text-gray-300 focus-visible:ring-2 focus-visible:ring-blue-500/45"
            aria-expanded={detailsOpen}
          >
            {detailsOpen ? (
              <ChevronUp className="h-3 w-3" strokeWidth={2.2} aria-hidden />
            ) : (
              <ChevronDown className="h-3 w-3" strokeWidth={2.2} aria-hidden />
            )}
            执行详情
          </button>
        ) : null}

        {showDetails && hasTimelineDetails && timeline && !isUser ? (
          <AssistantTurnTimeline
            model={timeline}
            compact={!isRunning}
            onCancel={isRunning && onCancel ? () => onCancel(message.id) : undefined}
          />
        ) : null}

        {showDetails && !isUser && message.childRuns?.length ? (
          <ChildRunProgressCards
            childRuns={message.childRuns as AgentChildRun[]}
            compact={!isRunning}
          />
        ) : null}

        {isDone && message.resultThumb ? (
          <div className="flex flex-col gap-1.5 pt-0.5">
            <ChatThumb
              item={message.resultThumb}
              size={140}
              className="rounded-xl"
              onClick={
                onResultPreview
                  ? (event) => onResultPreview(message.resultThumb!.id, event)
                  : undefined
              }
            />
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
                onClick={() => {
                  if (retryAction && onAction) {
                    onAction(message.id, retryAction);
                    return;
                  }
                  onRetry(message.id);
                }}
                className="inline-flex w-fit items-center gap-1.5 rounded-md bg-white/[0.08] px-2 py-1 text-[10px] font-semibold text-gray-200 ring-1 ring-white/[0.1] outline-none transition-colors hover:bg-white/[0.12] focus-visible:ring-2 focus-visible:ring-blue-500/45"
              >
                <RotateCcw className="h-3 w-3" strokeWidth={2.2} aria-hidden />
                重试
              </button>
            ) : null}
          </div>
        ) : null}

        {!isUser && suggestedActions.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 pt-1" data-agent-suggested-actions>
            {suggestedActions.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => {
                  if (a.kind === 'open_panel') setDetailsOpen(true);
                  if (a.kind === 'retry' && !onAction && onRetry) {
                    onRetry(message.id);
                    return;
                  }
                  onAction?.(message.id, a);
                }}
                className="inline-flex min-h-7 max-w-full items-center rounded-md bg-white/[0.07] px-2 py-1 text-[10px] font-semibold text-gray-200 ring-1 ring-white/[0.09] outline-none transition-colors hover:bg-white/[0.12] hover:text-white focus-visible:ring-2 focus-visible:ring-blue-500/45"
                title={a.label}
              >
                <span className="truncate">{a.label}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
