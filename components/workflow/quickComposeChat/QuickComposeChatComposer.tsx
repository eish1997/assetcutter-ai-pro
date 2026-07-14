import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { RIGHT_DOCK_COMPOSER_SAFE_BOTTOM_CLASS } from '../../floatingDockConstants';
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
import QuickComposeDropTray from '../QuickComposeDropTray';
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
  attachmentStripDefaultExpanded?: boolean;
};

/**
 * Chat sidebar composer: attachments → gen params → input with inline send.
 */
export default function QuickComposeChatComposer({
  segments,
  onSegmentsChange,
  mentionCandidates,
  maxMentions,
  placeholder = '想创作什么？输入 @ 引用参考图',
  mainDropSlots,
  referenceDropSlots,
  onRemoveMainDropSlot,
  onRemoveReferenceDropSlot,
  onMoveDropSlot,
  onReorderDropSlot,
  hideMainDropZone = false,
  onComposeInputDragOver,
  onComposeInputDrop,
  onDropSlotClick,
  promptCards = [],
  onRemovePromptCard,
  inputDisabled = false,
  submitDisabled = false,
  submitDisabledReason,
  threadBusy = false,
  threadBusyHint,
  onSubmit,
  attachmentStripDefaultExpanded = false,
  genControls,
}: QuickComposeChatComposerProps) {
  const mentionFieldRef = useRef<QuickComposeMentionFieldHandle | null>(null);
  const [attachmentExpanded, setAttachmentExpanded] = useState(attachmentStripDefaultExpanded);
  const [genControlsExpanded, setGenControlsExpanded] = useState(false);
  const attachmentCount = mainDropSlots.length + referenceDropSlots.length;

  // 拖入能力预设后自动展开附件条，避免「拖进去了但看不见」
  useEffect(() => {
    if (promptCards.length > 0 || attachmentCount > 0) setAttachmentExpanded(true);
  }, [attachmentCount, promptCards.length]);

  const submitDisabledTitle = submitDisabled ? submitDisabledReason : undefined;

  const hasDropContent =
    mainDropSlots.length > 0 ||
    referenceDropSlots.length > 0 ||
    !hideMainDropZone;

  const showMainDropColumn = !hideMainDropZone;
  const showReferenceDropColumn = true;
  const showSplitDropZones = showMainDropColumn || showReferenceDropColumn;
  const showZoneDivider = showMainDropColumn && showReferenceDropColumn;
  const hasMainDropSlots = mainDropSlots.length > 0;
  const splitDropZoneGridCols = showZoneDivider
    ? 'grid-cols-[1fr_auto_1fr]'
    : showMainDropColumn
      ? 'grid-cols-1'
      : 'grid-cols-1';

  const bindQuickComposeDropZone = useCallback(
    (zone: QuickComposeDropZone) => ({
      onDragOver: (e: React.DragEvent) => {
        e.preventDefault();
        onComposeInputDragOver?.(e);
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        onComposeInputDrop?.(e, zone);
      },
    }),
    [onComposeInputDragOver, onComposeInputDrop]
  );

  const handleDropSlotClick = useCallback(
    (slot: QuickComposeDropSlot) => {
      if (onDropSlotClick) {
        onDropSlotClick(slot);
        return;
      }
      mentionFieldRef.current?.insertMentionCandidate({
        kind: 'asset',
        assetId: slot.assetId,
        label: slot.label,
        previewSrc: slot.previewSrc,
      });
    },
    [onDropSlotClick]
  );

  const handleShellDragOver = useCallback(
    (e: React.DragEvent) => {
      // 先允许放置，避免仅转发时未 preventDefault 导致 drop 失败
      e.preventDefault();
      try {
        e.dataTransfer.dropEffect = 'copy';
      } catch {
        /* ignore */
      }
      onComposeInputDragOver?.(e);
    },
    [onComposeInputDragOver]
  );

  const handleShellDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onComposeInputDrop?.(e, 'main');
    },
    [onComposeInputDrop]
  );

  return (
    <div
      className={`relative z-[10] flex shrink-0 flex-col gap-2 border-t border-white/[0.06] bg-[#0f0f12] px-3 pt-2 ${RIGHT_DOCK_COMPOSER_SAFE_BOTTOM_CLASS} pointer-events-auto`}
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

      {hasDropContent ? (
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => setAttachmentExpanded((v) => !v)}
            className="inline-flex w-fit items-center gap-1 rounded-md px-1 py-0.5 text-[9px] font-semibold text-gray-500 outline-none transition-colors hover:bg-white/[0.06] hover:text-gray-300 focus-visible:ring-2 focus-visible:ring-blue-500/45"
            aria-expanded={attachmentExpanded}
          >
            {attachmentExpanded ? (
              <ChevronUp className="h-3 w-3" strokeWidth={2.2} aria-hidden />
            ) : (
              <ChevronDown className="h-3 w-3" strokeWidth={2.2} aria-hidden />
            )}
            附件
            {attachmentCount > 0 ? (
              <span className="tabular-nums text-gray-600">
                ({attachmentCount})
              </span>
            ) : null}
          </button>

          {attachmentExpanded ? (
            <div className={`flex flex-col gap-2 px-2 py-1.5 ${WORKFLOW_QUICK_COMPOSE_BAR_SHELL}`}>
              {showSplitDropZones ? (
                <div className={`grid gap-x-0 gap-y-1 px-1 pb-2 ${splitDropZoneGridCols}`}>
                  {showMainDropColumn ? (
                    hasMainDropSlots ? (
                      <span className="justify-self-center px-1.5 text-[9px] font-semibold text-gray-500">
                        主图（待修改）
                      </span>
                    ) : (
                      <div className="px-1.5" aria-hidden />
                    )
                  ) : null}
                  {showZoneDivider ? <div className="pointer-events-none" aria-hidden /> : null}
                  {showReferenceDropColumn ? (
                    <span className="justify-self-center px-1.5 text-[9px] font-semibold text-gray-500">
                      {hideMainDropZone ? '参考图（当前图为主图）' : '参考图'}
                    </span>
                  ) : null}
                  {showMainDropColumn ? (
                    <div
                      data-quick-compose-drop-zone="main"
                      className="inline-flex w-fit max-w-full shrink-0 justify-self-center px-1.5"
                      {...bindQuickComposeDropZone('main')}
                    >
                      <QuickComposeDropTray
                        zone="main"
                        slots={mainDropSlots}
                        disabled={false}
                        onRemoveSlot={onRemoveMainDropSlot}
                        onReorderSlot={
                          onReorderDropSlot
                            ? (assetId, toIndex) => onReorderDropSlot(assetId, 'main', toIndex)
                            : undefined
                        }
                        onMoveSlotToZone={
                          onMoveDropSlot ? (assetId) => onMoveDropSlot(assetId, 'reference') : undefined
                        }
                        onSlotClick={handleDropSlotClick}
                        onStashCaret={() => mentionFieldRef.current?.stashCaretBeforeBlur()}
                        emptyHint="拖入主图"
                      />
                    </div>
                  ) : null}
                  {showZoneDivider ? (
                    <div
                      className="pointer-events-none mx-auto h-[2px] w-full max-w-[12rem] justify-self-center rounded-full bg-white/35 shadow-[0_0_6px_rgba(255,255,255,0.12)]"
                      aria-hidden
                    />
                  ) : null}
                  {showReferenceDropColumn ? (
                    <div
                      data-quick-compose-drop-zone="reference"
                      className="inline-flex w-fit max-w-full shrink-0 justify-self-center px-1.5"
                      {...bindQuickComposeDropZone('reference')}
                    >
                      <QuickComposeDropTray
                        zone="reference"
                        slots={referenceDropSlots}
                        disabled={false}
                        onRemoveSlot={onRemoveReferenceDropSlot}
                        onReorderSlot={
                          onReorderDropSlot
                            ? (assetId, toIndex) => onReorderDropSlot(assetId, 'reference', toIndex)
                            : undefined
                        }
                        onMoveSlotToZone={
                          onMoveDropSlot && showMainDropColumn
                            ? (assetId) => onMoveDropSlot(assetId, 'main')
                            : undefined
                        }
                        onSlotClick={handleDropSlotClick}
                        onStashCaret={() => mentionFieldRef.current?.stashCaretBeforeBlur()}
                        emptyHint={hideMainDropZone ? '粘贴或 @ 引用其它资产' : '拖入参考图'}
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {genControls ? (
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => setGenControlsExpanded((v) => !v)}
            className="inline-flex w-fit items-center gap-1 rounded-md px-1 py-0.5 text-[9px] font-semibold text-gray-500 outline-none transition-colors hover:bg-white/[0.06] hover:text-gray-300 focus-visible:ring-2 focus-visible:ring-blue-500/45"
            aria-expanded={genControlsExpanded}
          >
            {genControlsExpanded ? (
              <ChevronUp className="h-3 w-3" strokeWidth={2.2} aria-hidden />
            ) : (
              <ChevronDown className="h-3 w-3" strokeWidth={2.2} aria-hidden />
            )}
            参数
          </button>
          {genControlsExpanded ? (
            <div className={`shrink-0 ${WORKFLOW_QUICK_COMPOSE_BAR_SHELL}`}>
              <div className="flex flex-wrap items-center gap-2 px-2 py-1.5">{genControls}</div>
            </div>
          ) : null}
        </div>
      ) : null}

      {threadBusy ? (
        <div
          className="shrink-0 border-t border-white/[0.06] bg-blue-500/[0.06] px-3 py-1.5 text-[10px] font-medium text-blue-200/90"
          data-chat-busy-hint
          role="status"
        >
          {threadBusyHint || COMPOSER_BUSY_HINT}
        </div>
      ) : null}

      <div className={`relative min-h-[3.5rem] shrink-0 ${WORKFLOW_QUICK_COMPOSE_BAR_SHELL} px-2 py-1.5 pr-12`}>
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
          onDragOver={onComposeInputDragOver}
          onDrop={(e) => onComposeInputDrop?.(e, 'main')}
        />
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
    </div>
  );
}
