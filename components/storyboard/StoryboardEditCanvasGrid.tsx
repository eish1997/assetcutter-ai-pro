import React, { useCallback, useRef, useState } from 'react';
import type { StoryboardRoleAsset, StoryboardTableRow } from '../../types';
import { computeStoryboardFrameRoleMarkPosition } from '../../services/storyboardFrameRoleMarks';
import { resolveStoryboardRowFrameDisplaySrc } from '../../services/storyboardFrameImageUrl';
import { storyboardRowOutlineTitle, storyboardRowHasEditFeedback, storyboardRowIsPassed } from './storyboardRowDisplay';
import StoryboardEditFeedbackMark from './StoryboardEditFeedbackMark';
import StoryboardFrameRoleContextMenu from './StoryboardFrameRoleContextMenu';
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

type RoleMenuState = {
  rowId: string;
  clientX: number;
  clientY: number;
  normX: number;
  normY: number;
};

type Props = {
  rows: StoryboardTableRow[];
  activeRowId: string | null;
  selectedRowIds: ReadonlySet<string>;
  imageBusyRowId?: string | null;
  highlightedRowIds?: ReadonlySet<string> | null;
  previewRowImages?: Readonly<Record<string, string>> | null;
  roleAssets?: StoryboardRoleAsset[];
  readOnly?: boolean;
  onSelectRow: (rowId: string, modifiers?: StoryboardCanvasSelectModifiers) => void;
  onMarqueeSelect: (rowIds: string[], additive: boolean) => void;
  onPreviewImage?: (src: string) => void;
  onAddFrameRoleMark?: (
    rowId: string,
    mark: { name: string; x: number; y: number; roleAssetId?: string }
  ) => void;
};

export default function StoryboardEditCanvasGrid({
  rows,
  activeRowId,
  selectedRowIds,
  imageBusyRowId = null,
  highlightedRowIds = null,
  previewRowImages = null,
  roleAssets = [],
  readOnly = false,
  onSelectRow,
  onMarqueeSelect,
  onPreviewImage,
  onAddFrameRoleMark,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [roleMenu, setRoleMenu] = useState<RoleMenuState | null>(null);

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

  const closeRoleMenu = useCallback(() => setRoleMenu(null), []);

  const handleFrameContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>, row: StoryboardTableRow) => {
      if (readOnly || !onAddFrameRoleMark) return;
      if (storyboardRowIsPassed(row)) return;
      const img = previewRowImages?.[row.id] || resolveStoryboardRowFrameDisplaySrc(row);
      if (!img) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      const { x, y } = computeStoryboardFrameRoleMarkPosition(event.clientX, event.clientY, rect);
      setRoleMenu({
        rowId: row.id,
        clientX: event.clientX,
        clientY: event.clientY,
        normX: x,
        normY: y,
      });
    },
    [onAddFrameRoleMark, previewRowImages, readOnly]
  );

  const handlePickRole = useCallback(
    (asset: StoryboardRoleAsset) => {
      if (!roleMenu || !onAddFrameRoleMark) return;
      onAddFrameRoleMark(roleMenu.rowId, {
        name: asset.name.trim(),
        roleAssetId: asset.id,
        x: roleMenu.normX,
        y: roleMenu.normY,
      });
    },
    [onAddFrameRoleMark, roleMenu]
  );

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
    <>
      <div
        ref={containerRef}
        className={`relative touch-none select-none ${STORYBOARD_EDIT_CANVAS_GRID}`}
        onPointerDown={onContainerPointerDown}
      >
        {marqueeStyle ? (
          <div
            className="pointer-events-none absolute z-20 rounded border border-white/40 bg-white/[0.06] ring-1 ring-white/20"
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
          const roleMarks = row.frameRoleMarks ?? [];

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
                onContextMenu={(event) => handleFrameContextMenu(event, row)}
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
                {roleMarks.map((mark) => (
                  <span
                    key={mark.id}
                    className="pointer-events-none absolute z-[5] max-w-[94%] truncate rounded-md border border-white/50 bg-black/85 px-2 py-1 text-[11px] font-bold leading-none text-white shadow-[0_0_0_1px_rgba(255,255,255,0.15),0_4px_16px_rgba(0,0,0,0.75)] ring-2 ring-white/20"
                    style={{
                      left: `${mark.x * 100}%`,
                      top: `${mark.y * 100}%`,
                      transform: 'translate(-50%, -50%)',
                    }}
                    title={mark.name}
                  >
                    {mark.name}
                  </span>
                ))}
                {busy ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-[9px] text-gray-200">
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
      <StoryboardFrameRoleContextMenu
        open={Boolean(roleMenu)}
        x={roleMenu?.clientX ?? 0}
        y={roleMenu?.clientY ?? 0}
        roleAssets={roleAssets}
        onPick={handlePickRole}
        onClose={closeRoleMenu}
      />
    </>
  );
}
