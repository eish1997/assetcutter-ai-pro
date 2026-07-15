import React, { useRef } from 'react';
import type {
  QuickComposeDropSlot,
  QuickComposeDropZone,
  QuickComposeMentionCandidate,
  QuickComposeSegment,
} from '../../../services/quickComposeMention';
import type {
  WorkspaceQuickComposeComposeMode,
  WorkspaceQuickComposePromptCard,
} from '../../WorkspaceQuickComposeBar';
import QuickComposeMentionField, {
  type QuickComposeMentionFieldHandle,
} from '../QuickComposeMentionField';
import { WORKFLOW_QUICK_COMPOSE_BAR_SHELL } from '../workflowSectionUiConstants';
import { COMPOSER_BUSY_HINT } from './chatUiCopy';

const COMPOSER_INPUT_MIN_ROWS = 2;
const COMPOSER_INPUT_MAX_ROWS = 8;
const COMPOSER_LINE_PX = 28;
const COMPOSER_INPUT_MAX_HEIGHT_PX = COMPOSER_INPUT_MAX_ROWS * COMPOSER_LINE_PX;

export type QuickComposeChatComposerProps = {
  segments: QuickComposeSegment[];
  onSegmentsChange: (next: QuickComposeSegment[]) => void;
  mentionCandidates: QuickComposeMentionCandidate[];
  maxMentions: number;
  placeholder?: string;
  mainDropSlots: QuickComposeDropSlot[];
  referenceDropSlots: QuickComposeDropSlot[];
  onRemoveMainDropSlot: (assetId: string) => void;
  onRemoveReferenceDropSlot: (assetId: string) => void;
  onMoveDropSlot?: (assetId: string, toZone: QuickComposeDropZone) => void;
  onReorderDropSlot?: (assetId: string, zone: QuickComposeDropZone, toIndex: number) => void;
  hideMainDropZone?: boolean;
  onComposeInputDragOver?: (e: React.DragEvent) => void;
  onComposeInputDrop?: (e: React.DragEvent, zone: QuickComposeDropZone) => void;
  onDropSlotClick?: (slot: QuickComposeDropSlot) => void;
  promptCards?: WorkspaceQuickComposePromptCard[];
  onRemovePromptCard?: (key: string) => void;
  /** 积分不足：禁用输入框 */
  inputDisabled?: boolean;
  /** 积分 / 空 draft / 助手进行中：仅禁用发送 */
  submitDisabled?: boolean;
  submitDisabledReason?: string;
  /** P0.5-a：线程有进行中助手时展示忙态条 */
  threadBusy?: boolean;
  threadBusyHint?: string;
  onSubmit: () => void;
  composeMode?: WorkspaceQuickComposeComposeMode;
  onComposeModeChange?: (mode: WorkspaceQuickComposeComposeMode) => void;
  modeLockedByInputPresets?: boolean;
  /** 文/图/3D + 模型 + 参数（渲染在输入框上方） */
  genControls?: React.ReactNode;
};

/**
 * Chat sidebar composer: input first, then lightweight parameters.
 */
export default function QuickComposeChatComposer({
  segments,
  onSegmentsChange,
  mentionCandidates,
  maxMentions,
  placeholder = '说说你想完成什么...',
  promptCards = [],
  onRemovePromptCard,
  inputDisabled = false,
  submitDisabled = false,
  submitDisabledReason,
  threadBusy = false,
  threadBusyHint,
  onSubmit,
  genControls,
}: QuickComposeChatComposerProps) {
  const mentionFieldRef = useRef<QuickComposeMentionFieldHandle | null>(null);

  const submitDisabledTitle = submitDisabled ? submitDisabledReason : undefined;

  const handleShellDragOver = (e: React.DragEvent) => {
      // 先允许放置，避免仅转发时未 preventDefault 导致 drop 失败
      e.preventDefault();
      try {
        e.dataTransfer.dropEffect = 'none';
      } catch {
        /* ignore */
      }
  };

  const handleShellDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div
      className="relative z-[10] flex shrink-0 flex-col gap-2 border-b border-white/[0.06] bg-[#0f0f12] px-3 py-2 pointer-events-auto"
      data-quick-compose-chat-composer
      onDragOver={handleShellDragOver}
      onDrop={handleShellDrop}
    >
      {promptCards.length > 0 && onRemovePromptCard ? (
        <div className="flex flex-wrap items-center gap-2">
          {promptCards.map((c) => (
            <div
              key={c.key}
              className="group inline-flex max-w-full min-w-0 shrink-0 items-center gap-1.5 rounded-lg bg-blue-500/15 px-2.5 py-1.5 ring-1 ring-blue-400/30"
              title={c.instruction.trim() ? c.instruction : c.label}
            >
              <span className="min-w-0 truncate text-[12px] font-medium text-gray-100">{c.label}</span>
              <button
                type="button"
                onClick={() => onRemovePromptCard(c.key)}
                className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-gray-400 outline-none transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-blue-500/50"
                aria-label={`移除 ${c.label}`}
              >
                <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className={`relative min-h-[6.5rem] shrink-0 ${WORKFLOW_QUICK_COMPOSE_BAR_SHELL} px-2 py-1.5 pb-11 pr-12`}>
        <QuickComposeMentionField
          ref={mentionFieldRef}
          segments={segments}
          onSegmentsChange={onSegmentsChange}
          mentionCandidates={mentionCandidates}
          maxMentions={maxMentions}
          placeholder={placeholder}
          disabled={inputDisabled}
          multiline
          rows={COMPOSER_INPUT_MIN_ROWS}
          multilineMaxHeightPx={COMPOSER_INPUT_MAX_HEIGHT_PX}
          ariaLabel="快捷生成描述"
          onSubmit={onSubmit}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => e.preventDefault()}
        />
        {genControls ? (
          <div className="absolute bottom-1.5 left-2 right-12 z-[2] flex min-h-9 min-w-0 items-center overflow-hidden">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">{genControls}</div>
          </div>
        ) : null}
        <button
          type="button"
          disabled={submitDisabled}
          onClick={onSubmit}
          className="absolute bottom-1.5 right-1.5 z-[2] flex h-9 w-9 items-center justify-center rounded-full bg-white text-[#0a0a0c] shadow-md outline-none transition-transform hover:scale-[1.03] active:scale-[0.98] disabled:opacity-35 focus-visible:ring-2 focus-visible:ring-blue-500/55"
          title={submitDisabledTitle ?? '发送（Ctrl+Enter）'}
          aria-label={submitDisabledTitle ?? '发送'}
        >
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M5 12h14M13 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {threadBusy ? (
        <div
          className="shrink-0 border-t border-white/[0.06] bg-blue-500/[0.06] px-3 py-1.5 text-[10px] font-medium text-blue-200/90"
          data-chat-busy-hint
          role="status"
        >
          {threadBusyHint || COMPOSER_BUSY_HINT}
        </div>
      ) : null}
    </div>
  );
}
