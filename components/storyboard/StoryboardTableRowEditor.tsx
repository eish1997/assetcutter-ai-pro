import React, { useEffect, useState } from 'react';
import type { StoryboardTableRow } from '../../types';
import {
  normalizeStoryboardShotNoInput,
  parseDurationSecFromParsedValue,
} from '../../services/storyboardTableParse';
import {
  resolveStoryboardRowFrameDisplaySrc,
  storyboardRowHasFrameRef,
} from '../../services/storyboardFrameImageUrl';
import {
  resolveStoryboardFrameVersionDisplaySrc,
  storyboardFrameHistorySignature,
  storyboardFrameVersionLabel,
} from '../../services/storyboardFrameHistory';
import { storyboardFrameImageDropAllowed } from '../../services/storyboardFrameDrag';
import AppIcon from '../ui/AppIcon';
import { CustomDropdown } from '../ui/CustomDropdown';
import { storyboardRowOutlineTitle, storyboardRowHasEditFeedback, storyboardRowIsPassed } from './storyboardRowDisplay';
import StoryboardEditFeedbackMark from './StoryboardEditFeedbackMark';
import {
  STORYBOARD_FIELD_INPUT,
  STORYBOARD_GAP_INNER,
  STORYBOARD_GAP_TIGHT,
  STORYBOARD_LABEL,
  STORYBOARD_PAD_CARD,
  STORYBOARD_PAD_ROW_BAR,
  STORYBOARD_ROW_ACTIVE,
  STORYBOARD_ROW_ICON_BTN,
  STORYBOARD_ROW_IDLE,
  STORYBOARD_ROW_SHELL,
  STORYBOARD_SCROLL_MT,
} from './storyboardTableUi';

const LAYER_DROPDOWN_Z = { backdrop: 2200, list: 2201 };

function textareaRowsForText(text: string, minRows = 2): number {
  if (!text.trim()) return minRows;
  const lines = text.split('\n').length;
  const wrapped = Math.ceil(text.length / 34);
  return Math.max(minRows, lines, wrapped);
}

type Props = {
  row: StoryboardTableRow;
  index: number;
  rowCount: number;
  active: boolean;
  readOnly: boolean;
  imageBusy: boolean;
  onFocusRow: () => void;
  onPatch: (patch: Partial<StoryboardTableRow>) => void;
  onCommitShotNo?: (raw: string) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onPickImage: () => void;
  onClearImage: () => void;
  onPreviewImage: () => void;
  onImageDrop: (e: React.DragEvent) => void;
  onImagePaste: (e: React.ClipboardEvent) => void;
  redrawBusy?: boolean;
  redrawDisabled?: boolean;
  redrawDisabledReason?: string;
  onRedraw?: () => void;
  onRestoreFrameVersion?: (versionId: string) => void;
  domId?: string;
  timelineLayerCount?: number;
  editDisplayMode?: 'full' | 'feedback';
};

function stopInputFocusBubble(e: React.SyntheticEvent) {
  e.stopPropagation();
}

export default function StoryboardTableRowEditor({
  row,
  index,
  rowCount,
  active,
  readOnly,
  imageBusy,
  onFocusRow,
  onPatch,
  onCommitShotNo,
  onMove,
  onRemove,
  onPickImage,
  onClearImage,
  onPreviewImage,
  onImageDrop,
  onImagePaste,
  redrawBusy = false,
  redrawDisabled = false,
  redrawDisabledReason,
  onRedraw,
  onRestoreFrameVersion,
  domId,
  timelineLayerCount = 1,
  editDisplayMode = 'full',
}: Props) {
  const [durationDraft, setDurationDraft] = useState<string | null>(null);
  const feedbackMode = editDisplayMode === 'feedback';
  const passed = storyboardRowIsPassed(row);
  const fieldsReadOnly = readOnly || passed;
  const img = resolveStoryboardRowFrameDisplaySrc(row);
  const shotLabel = storyboardRowOutlineTitle(row, index);
  const shell = `${STORYBOARD_ROW_SHELL} ${passed ? 'opacity-70' : ''} ${
    active ? STORYBOARD_ROW_ACTIVE : STORYBOARD_ROW_IDLE
  }`;

  useEffect(() => {
    setDurationDraft(null);
  }, [row.id]);

  const durationInputValue =
    durationDraft ?? (row.durationSec != null ? String(row.durationSec) : '');

  return (
    <article
      id={domId}
      className={`${shell} ${STORYBOARD_SCROLL_MT} flex w-full min-w-0 flex-col`}
      onFocusCapture={onFocusRow}
    >
      <div
        className={`flex shrink-0 flex-wrap items-center border-b border-white/[0.05] ${STORYBOARD_PAD_ROW_BAR} ${STORYBOARD_GAP_INNER}`}
      >
        <span className="inline-flex h-7 min-w-[1.75rem] items-center justify-center rounded-lg bg-white/[0.08] text-[10px] font-bold text-gray-200 ring-1 ring-white/12">
          {index + 1}
        </span>
        <span className="text-[11px] font-semibold text-gray-200">镜头 {shotLabel}</span>
        {storyboardRowHasEditFeedback(row) ? <StoryboardEditFeedbackMark row={row} /> : null}
        {passed ? (
          <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-300/90 ring-1 ring-emerald-400/25">
            已通过
          </span>
        ) : null}
        {!readOnly ? (
          <div className={`ml-auto flex items-center ${STORYBOARD_GAP_TIGHT}`}>
            {passed ? (
              <button
                type="button"
                title="取消通过"
                aria-label="取消通过"
                onClick={() => onPatch({ locked: false })}
                className={`${STORYBOARD_ROW_ICON_BTN} bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/30 hover:bg-emerald-500/20 hover:text-emerald-200`}
              >
                <AppIcon name="check" className="h-3.5 w-3.5" />
              </button>
            ) : (
              <>
            {onRedraw ? (
              <button
                type="button"
                title={
                  redrawDisabledReason ||
                  (storyboardRowHasFrameRef(row)
                    ? '拼图改图：按修改反馈改图（保持画风）'
                    : '根据原文文生图重绘')
                }
                aria-label={redrawBusy ? '生成中' : '重绘'}
                disabled={redrawDisabled || redrawBusy}
                onClick={onRedraw}
                className={`${STORYBOARD_ROW_ICON_BTN} ${
                  redrawBusy
                    ? 'bg-white/[0.12] text-gray-200 ring-1 ring-white/15'
                    : redrawDisabled
                      ? 'text-gray-600'
                      : 'text-gray-300 hover:bg-white/[0.08] hover:text-white'
                }`}
              >
                <AppIcon
                  name="refresh"
                  className={`h-3.5 w-3.5 ${redrawBusy ? 'animate-spin' : ''}`}
                />
              </button>
            ) : null}
            <button
              type="button"
              title="通过本镜"
              aria-label="通过本镜"
              onClick={() => onPatch({ locked: true })}
              className={STORYBOARD_ROW_ICON_BTN}
            >
              <AppIcon name="check" className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title="删除镜头"
              aria-label="删除镜头"
              onClick={onRemove}
              className={`${STORYBOARD_ROW_ICON_BTN} hover:bg-red-500/10 hover:text-red-300`}
            >
              <AppIcon name="trash" className="h-3.5 w-3.5" />
            </button>
            <span className="mx-0.5 h-4 w-px shrink-0 bg-white/[0.08]" aria-hidden />
            <button
              type="button"
              title="上移"
              aria-label="上移"
              disabled={index === 0}
              onClick={() => onMove(-1)}
              className={STORYBOARD_ROW_ICON_BTN}
            >
              <AppIcon name="chevron-up" className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title="下移"
              aria-label="下移"
              disabled={index >= rowCount - 1}
              onClick={() => onMove(1)}
              className={STORYBOARD_ROW_ICON_BTN}
            >
              <AppIcon name="chevron-down" className="h-3.5 w-3.5" />
            </button>
              </>
            )}
          </div>
        ) : null}
      </div>

      <div className={`${STORYBOARD_PAD_CARD} ${STORYBOARD_GAP_INNER} flex flex-col`}>
          <div className="min-w-0">
            <span className={STORYBOARD_LABEL}>分镜图</span>
            <div
              className={`relative aspect-video w-full overflow-hidden rounded-xl ring-1 ring-white/[0.08] ${
                imageBusy ? 'opacity-60' : ''
              }`}
              onDragOver={(e) => {
                if (fieldsReadOnly) return;
                if (!storyboardFrameImageDropAllowed(e.dataTransfer)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
              }}
              onDrop={(e) => {
                if (fieldsReadOnly) return;
                e.preventDefault();
                onImageDrop(e);
              }}
              onPaste={(e) => {
                if (fieldsReadOnly) return;
                onImagePaste(e);
              }}
            >
              {img ? (
                <button
                  type="button"
                  title={fieldsReadOnly ? '放大预览' : '预览与裁切'}
                  className="block h-full w-full"
                  onClick={onPreviewImage}
                >
                  <img
                    src={img}
                    alt=""
                    className="h-full w-full object-contain bg-black/25"
                    draggable={false}
                  />
                </button>
              ) : (
                <button
                  type="button"
                  disabled={fieldsReadOnly || imageBusy}
                  onClick={onPickImage}
                  className="flex h-full w-full flex-col items-center justify-center gap-1 bg-black/25 text-[10px] text-gray-500 transition-colors hover:text-white/90 disabled:cursor-not-allowed"
                >
                  {imageBusy ? '处理中…' : '点击或拖入（裁切）'}
                </button>
              )}
              {imageBusy ? (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-[10px] text-gray-300">
                  压缩入库…
                </div>
              ) : null}
            </div>
            {!fieldsReadOnly && img ? (
              <div className={`mt-1 flex ${STORYBOARD_GAP_INNER}`}>
                <button
                  type="button"
                  onClick={onPickImage}
                  className="text-[10px] text-gray-500 hover:text-gray-200"
                >
                  替换
                </button>
                <button
                  type="button"
                  onClick={onClearImage}
                  className="text-[10px] text-gray-500 hover:text-red-300"
                >
                  清除
                </button>
              </div>
            ) : null}
            {!fieldsReadOnly && row.frameImageHistory?.length ? (
              <div className="mt-2">
                <span className={STORYBOARD_LABEL}>历史版本</span>
                <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                  {row.frameImageHistory.map((version, historyIndex) => {
                    const thumb = resolveStoryboardFrameVersionDisplaySrc(version);
                    if (!thumb) return null;
                    return (
                      <button
                        key={version.id}
                        type="button"
                        title={`回退：${storyboardFrameVersionLabel(version, historyIndex)}`}
                        disabled={imageBusy}
                        onClick={() => onRestoreFrameVersion?.(version.id)}
                        className="shrink-0 overflow-hidden rounded-md border border-white/[0.08] transition-colors hover:border-white/25 hover:ring-1 hover:ring-white/15 disabled:opacity-50"
                      >
                        <img
                          src={thumb}
                          alt=""
                          className="h-9 w-14 object-cover bg-black/30"
                          draggable={false}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>

          {feedbackMode ? (
            <label className="block">
              <span className={STORYBOARD_LABEL}>修改反馈</span>
              <textarea
                value={row.editFeedback ?? ''}
                readOnly={fieldsReadOnly}
                onChange={(e) => onPatch({ editFeedback: e.target.value })}
                onMouseDown={stopInputFocusBubble}
                onFocus={stopInputFocusBubble}
                rows={textareaRowsForText(row.editFeedback ?? '', 4)}
                className={`${STORYBOARD_FIELD_INPUT} min-h-[6rem] resize-y leading-relaxed`}
                placeholder="描述需要修改的画面、构图、动作等问题…"
              />
            </label>
          ) : (
            <>
              <div className={`grid grid-cols-2 ${STORYBOARD_GAP_INNER}`}>
                <label className="block">
                  <span className={STORYBOARD_LABEL}>镜头号</span>
                  <input
                    value={row.shotNo ?? ''}
                    readOnly={fieldsReadOnly}
                    onChange={(e) => onPatch({ shotNo: e.target.value })}
                    onBlur={(e) => {
                      if (onCommitShotNo) {
                        onCommitShotNo(e.target.value);
                        return;
                      }
                      const normalized = normalizeStoryboardShotNoInput(e.target.value);
                      if (normalized && normalized !== (row.shotNo ?? '')) {
                        onPatch({ shotNo: normalized });
                      }
                    }}
                    onMouseDown={stopInputFocusBubble}
                    onFocus={stopInputFocusBubble}
                    className={STORYBOARD_FIELD_INPUT}
                    placeholder="041 或留空待编号"
                  />
                </label>
                <label className="block">
                  <span className={STORYBOARD_LABEL}>时长</span>
                  <div className="relative">
                    <input
                      value={durationInputValue}
                      readOnly={fieldsReadOnly}
                      onChange={(e) => setDurationDraft(e.target.value)}
                      onFocus={() => {
                        setDurationDraft(
                          row.durationSec != null ? String(row.durationSec) : ''
                        );
                      }}
                      onBlur={(e) => {
                        const parsed = parseDurationSecFromParsedValue(e.target.value);
                        onPatch({ durationSec: parsed });
                        setDurationDraft(null);
                      }}
                      onMouseDown={stopInputFocusBubble}
                      className={`${STORYBOARD_FIELD_INPUT} pr-6`}
                      placeholder="—"
                      inputMode="decimal"
                      step="any"
                    />
                    <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[9px] text-gray-600">
                      秒
                    </span>
                  </div>
                </label>
              </div>

              {timelineLayerCount > 1 ? (
                <label className="block max-w-[10rem]">
                  <span className={STORYBOARD_LABEL}>时间轴轨道</span>
                  <CustomDropdown
                    value={String(row.timelineLayer ?? 0)}
                    options={Array.from({ length: timelineLayerCount }, (_, i) => ({
                      value: String(i),
                      label: i === 0 ? `L${i} · 底层` : `L${i}`,
                    }))}
                    disabled={fieldsReadOnly}
                    onChange={(v) =>
                      onPatch({
                        timelineLayer: Math.min(timelineLayerCount - 1, Math.max(0, Number(v))),
                      })
                    }
                    triggerClassName="h-8 w-full rounded-lg bg-white/[0.04] px-2.5 text-[10px] text-gray-200 ring-1 ring-white/[0.07] hover:bg-white/[0.07]"
                    portalZIndex={LAYER_DROPDOWN_Z}
                  />
                </label>
              ) : null}

              <label className="block">
                <span className={STORYBOARD_LABEL}>原文</span>
                <textarea
                  value={row.shotRaw ?? ''}
                  readOnly={fieldsReadOnly}
                  onChange={(e) => onPatch({ shotRaw: e.target.value })}
                  onMouseDown={stopInputFocusBubble}
                  onFocus={stopInputFocusBubble}
                  rows={textareaRowsForText(row.shotRaw ?? '', 2)}
                  className={`${STORYBOARD_FIELD_INPUT} resize-y leading-relaxed`}
                  placeholder="该镜头的完整原文"
                />
              </label>
            </>
          )}
      </div>
    </article>
  );
}
