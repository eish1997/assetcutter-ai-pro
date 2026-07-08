import React from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import type {
  QuickComposeChatMessageView,
  QuickComposeMessageAttachmentThumb,
  QuickComposeMessageStatus,
} from '../../../types/quickComposeThread';
import { WORKFLOW_QUICK_COMPOSE_BAR_SHELL } from '../workflowSectionUiConstants';

export type QuickComposeChatMessageProps = {
  message: QuickComposeChatMessageView;
  onRetry?: (messageId: string) => void;
};

function isRunningStatus(status: QuickComposeMessageStatus | undefined): boolean {
  return status === 'queued' || status === 'understanding' || status === 'running';
}

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

/**
 * Gemini-style chat bubble for quick compose sidebar (user / assistant).
 */
export default function QuickComposeChatMessage({ message, onRetry }: QuickComposeChatMessageProps) {
  const isUser = message.role === 'user';
  const isRunning = message.role === 'assistant' && isRunningStatus(message.status);
  const isError = message.status === 'error';
  const text = message.text?.trim();
  const attachments = message.attachmentThumbs ?? [];

  const bubbleShell = isUser
    ? 'rounded-2xl rounded-br-md bg-blue-600/20 text-gray-100 ring-1 ring-blue-400/25'
    : `${WORKFLOW_QUICK_COMPOSE_BAR_SHELL} rounded-2xl rounded-bl-md text-gray-100`;

  return (
    <div className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex max-w-[min(100%,20rem)] min-w-0 flex-col gap-2 px-3 py-2.5 ${bubbleShell}`}>
        {attachments.length > 0 ? <AttachmentThumbRow items={attachments} /> : null}

        {text ? <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">{text}</p> : null}

        {isRunning ? (
          <div className="flex items-center gap-2 text-[11px] text-gray-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400/90" strokeWidth={2.2} aria-hidden />
            <span>
              {message.status === 'understanding'
                ? '理解中…'
                : message.status === 'queued'
                  ? '排队中…'
                  : '生成中…'}
            </span>
          </div>
        ) : null}

        {message.status === 'done' && message.resultThumb ? (
          <div className="flex flex-col gap-1.5">
            <ChatThumb item={message.resultThumb} size={120} className="rounded-xl" />
          </div>
        ) : null}

        {isError ? (
          <div className="flex flex-col gap-2">
            {message.errorMessage ? (
              <p className="text-[11px] leading-snug text-red-300/95">{message.errorMessage}</p>
            ) : (
              <p className="text-[11px] leading-snug text-red-300/95">生成失败</p>
            )}
            {onRetry ? (
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
