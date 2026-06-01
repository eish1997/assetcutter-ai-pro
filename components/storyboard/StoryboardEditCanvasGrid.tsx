import React, { useCallback, useRef } from 'react';
import type { StoryboardTableRow } from '../../types';
import { resolveStoryboardRowFrameDisplaySrc } from '../../services/storyboardFrameImageUrl';
import { storyboardRowOutlineTitle, storyboardRowHasEditFeedback } from './storyboardRowDisplay';
import StoryboardEditFeedbackMark from './StoryboardEditFeedbackMark';
import { storyboardCanvasTileDomId } from './storyboardTableDom';
import { useStoryboardCanvasMarqueeSelect } from '../../hooks/useStoryboardCanvasMarqueeSelect';
import {
  STORYBOARD_EDIT_CANVAS_GRID,
  STORYBOARD_ROW_CANVAS_MULTI_SELECTED,
  STORYBOARD_ROW_HISTORY_HIGHLIGHT,
  STORYBOARD_ROW_IDLE,
  STORYBOARD_ROW_SHELL,
} from './storyboardTableUi';

export type StoryboardCanvasSelectModifiers = {
  additive?: boolean;
  range?: boolean;
};

type Props = {
  rows: StoryboardTableRow[];
  activeRowId: string | null;
  selectedRowIds: ReadonlySet<string>;
  imageBusyRowId?: string | null;
  highlightedRowIds?: ReadonlySet<string> | null;
  previewRowImages?: Readonly<Record<string, string>> | null;
  readOnly?: boolean;
  onSelectRow: (rowId: string, modifiers?: StoryboardCanvasSelectModifiers) => void;
  onMarqueeSelect: (rowIds: string[], additive: boolean) => void;
  onPreviewImage?: (src: string) => void;
};

export default function StoryboardEditCanvasGrid({
  rows,
  activeRowId,
  selectedRowIds,
  imageBusyRowId = null,
  highlightedRowIds = null,
  previewRowImages = null,
  readOnly = false,
  onSelectRow,
  onMarqueeSelect,
  onPreviewImage,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMarqueeComplete = useCallback(
    (rowIds: string[], additive: boolean) => {
      onMarqueeSelect(rowIds, additive);
    },
    [onMarqueeSelect]
  );

  const { marqueeRect, onContainerPointerDown } = useStoryboardCanvasMarqueeSelect({
    containerRef,
    disabled: readOnly,
    onMarqueeComplete: handleMarqueeComplete,
    onTileSelect: onSelectRow,
  });

  if (!rows.length) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-10 text-center text-[10px] text-gray-600">
        暂无镜头，请添加或导入分镜
      </div>
    );
  }

  const containerRect = containerRef.current?.getBoundingClientRect();
  const marqueeStyle =
    marqueeRect && containerRect
      ? {
          left: marqueeRect.left - containerRect.left,
          top: marqueeRect.top - containerRect.top,
          width: marqueeRect.width,
          height: marqueeRect.height,
        }
      : null;

  return (
    <div
      ref={containerRef}
      className={`relative touch-none select-none ${STORYBOARD_EDIT_CANVAS_GRID}`}
      onPointerDown={onContainerPointerDown}
    >
      {marqueeStyle ? (
        <div
          className="pointer-events-none absolute z-20 rounded border border-violet-400/70 bg-violet-500/10 ring-1 ring-violet-400/40"
          style={marqueeStyle}
        />
      ) : null}
      {rows.map((row, index) => {
        const canvasSelected = selectedRowIds.has(row.id);
        const previewImg = previewRowImages?.[row.id];
        const img = previewImg || resolveStoryboardRowFrameDisplaySrc(row);
        const label = storyboardRowOutlineTitle(row, index);
        const busy = imageBusyRowId === row.id;
        const hasFeedback = storyboardRowHasEditFeedback(row);
        const historyHighlight = highlightedRowIds?.has(row.id) ?? false;

        const shellTone = (() => {
          if (canvasSelected && historyHighlight) {
            return `${STORYBOARD_ROW_IDLE} ${STORYBOARD_ROW_CANVAS_MULTI_SELECTED} ${STORYBOARD_ROW_HISTORY_HIGHLIGHT}`;
          }
          if (canvasSelected) {
            return `${STORYBOARD_ROW_IDLE} ${STORYBOARD_ROW_CANVAS_MULTI_SELECTED}`;
          }
          if (historyHighlight) {
            return `${STORYBOARD_ROW_IDLE} ${STORYBOARD_ROW_HISTORY_HIGHLIGHT}`;
          }
          if (hasFeedback) {
            return `${STORYBOARD_ROW_IDLE} border-sky-400/22 ring-1 ring-sky-400/18`;
          }
          return STORYBOARD_ROW_IDLE;
        })();

        return (
          <div
            key={row.id}
            id={storyboardCanvasTileDomId(row.id)}
            data-canvas-row-id={row.id}
            role="button"
            tabIndex={0}
            aria-selected={activeRowId === row.id}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelectRow(row.id);
              }
            }}
            className={`${STORYBOARD_ROW_SHELL} flex min-w-0 cursor-pointer flex-col overflow-hidden text-left transition ${shellTone}`}
          >
            <div className="flex items-center justify-between gap-1 border-b border-white/[0.06] px-2 py-1">
              <span className="flex min-w-0 items-center gap-1 truncate">
                <span className="truncate text-[10px] font-semibold text-gray-200">{label}</span>
                {hasFeedback ? (
                  <StoryboardEditFeedbackMark row={row} variant="dot" className="shrink-0" />
                ) : null}
              </span>
              <span className="flex shrink-0 items-center gap-1">
                {hasFeedback ? (
                  <StoryboardEditFeedbackMark row={row} label="反馈中..." />
                ) : null}
                {row.locked ? (
                  <span className="shrink-0 text-[8px] text-gray-500">已通过</span>
                ) : null}
              </span>
            </div>
            <div
              className={`relative aspect-[4/3] w-full bg-black/40 ${
                historyHighlight ? 'ring-2 ring-inset ring-amber-400/50' : ''
              }`}
            >
              {img ? (
                <img
                  src={img}
                  alt=""
                  className="pointer-events-none h-full w-full object-cover"
                  draggable={false}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[9px] text-gray-600">
                  待配图
                </div>
              )}
              {busy ? (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-[9px] text-violet-200">
                  处理中…
                </div>
              ) : null}
              {img && onPreviewImage ? (
                <button
                  type="button"
                  title="放大"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onPreviewImage(img);
                  }}
                  className="absolute bottom-1 right-1 z-10 rounded bg-black/65 px-1.5 py-0.5 text-[8px] text-gray-200 hover:bg-black/80"
                >
                  放大
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
