import React, { useCallback, useRef, useState } from 'react';
import type { StoryboardRoleAsset, StoryboardTableRow } from '../../types';
import {
  computeStoryboardFrameRoleMarkPosition,
  resolveStoryboardFrameRoleMarkDisplayName,
} from '../../services/storyboardFrameRoleMarks';
import { resolveStoryboardRowFrameDisplaySrc } from '../../services/storyboardFrameImageUrl';
import { storyboardRowOutlineTitle, storyboardRowHasEditFeedback, storyboardRowIsPassed } from './storyboardRowDisplay';
import StoryboardEditFeedbackMark from './StoryboardEditFeedbackMark';
import StoryboardFrameRoleContextMenu, {
  type StoryboardFrameRoleMenuMode,
} from './StoryboardFrameRoleContextMenu';
import StoryboardFrameRoleMarkChip from './StoryboardFrameRoleMarkChip';
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
  mode: StoryboardFrameRoleMenuMode;
  rowId: string;
  markId?: string;
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
  selectedFrameRoleMarkId?: string | null;
  readOnly?: boolean;
  onSelectRow: (rowId: string, modifiers?: StoryboardCanvasSelectModifiers) => void;
  onMarqueeSelect: (rowIds: string[], additive: boolean) => void;
  onPreviewRowFrame?: (row: StoryboardTableRow) => void;
  onSelectFrameRoleMark?: (rowId: string, markId: string | null) => void;
  onAddFrameRoleMark?: (
    rowId: string,
    mark: { name: string; x: number; y: number; roleAssetId?: string }
  ) => void;
  onUpdateFrameRoleMark?: (
    rowId: string,
    markId: string,
    patch: { x?: number; y?: number }
  ) => void;
  onRemoveFrameRoleMark?: (rowId: string, markId: string) => void;
  onRebindFrameRoleMark?: (rowId: string, markId: string, asset: StoryboardRoleAsset) => void;
  onSetFrameRoleMarkCustomName?: (rowId: string, markId: string, name: string) => void;
  /** null = 全部；非 null 时命中镜头高亮、未命中降权 */
  filterMatchedRowIds?: ReadonlySet<string> | null;
  filterFlashRowId?: string | null;
  roleReplaceEligibleRowIds?: ReadonlySet<string> | null;
  onAssignImagesFromDrop?: (rowId: string, e: React.DragEvent) => void;
};

export default function StoryboardEditCanvasGrid({
  rows,
  activeRowId,
  selectedRowIds,
  imageBusyRowId = null,
  highlightedRowIds = null,
  previewRowImages = null,
  roleAssets = [],
  selectedFrameRoleMarkId = null,
  readOnly = false,
  onSelectRow,
  onMarqueeSelect,
  onPreviewRowFrame,
  onSelectFrameRoleMark,
  onAddFrameRoleMark,
  onUpdateFrameRoleMark,
  onRemoveFrameRoleMark,
  onRebindFrameRoleMark,
  onSetFrameRoleMarkCustomName,
  filterMatchedRowIds = null,
  filterFlashRowId = null,
  roleReplaceEligibleRowIds = null,
  onAssignImagesFromDrop,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [roleMenu, setRoleMenu] = useState<RoleMenuState | null>(null);

  const canEditMarks =
    !readOnly &&
    Boolean(
      onAddFrameRoleMark ||
        onUpdateFrameRoleMark ||
        onRemoveFrameRoleMark ||
        onRebindFrameRoleMark ||
        onSetFrameRoleMarkCustomName
    );

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

  const openAddMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>, row: StoryboardTableRow) => {
      if (!canEditMarks || !onAddFrameRoleMark) return;
      if (storyboardRowIsPassed(row)) return;
      const img = previewRowImages?.[row.id] || resolveStoryboardRowFrameDisplaySrc(row);
      if (!img) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      const { x, y } = computeStoryboardFrameRoleMarkPosition(event.clientX, event.clientY, rect);
      onSelectFrameRoleMark?.(row.id, null);
      setRoleMenu({
        mode: 'add',
        rowId: row.id,
        clientX: event.clientX,
        clientY: event.clientY,
        normX: x,
        normY: y,
      });
    },
    [canEditMarks, onAddFrameRoleMark, onSelectFrameRoleMark, previewRowImages]
  );

  const openEditMenu = useCallback(
    (row: StoryboardTableRow, markId: string, clientX: number, clientY: number) => {
      if (!canEditMarks) return;
      if (storyboardRowIsPassed(row)) return;
      onSelectFrameRoleMark?.(row.id, markId);
      setRoleMenu({
        mode: 'edit',
        rowId: row.id,
        markId,
        clientX,
        clientY,
        normX: 0.5,
        normY: 0.5,
      });
    },
    [canEditMarks, onSelectFrameRoleMark]
  );

  const handlePickRole = useCallback(
    (asset: StoryboardRoleAsset) => {
      if (!roleMenu) return;
      if (roleMenu.mode === 'add') {
        if (!onAddFrameRoleMark) return;
        onAddFrameRoleMark(roleMenu.rowId, {
          name: asset.name.trim(),
          roleAssetId: asset.id,
          x: roleMenu.normX,
          y: roleMenu.normY,
        });
        return;
      }
      if (!roleMenu.markId || !onRebindFrameRoleMark) return;
      onRebindFrameRoleMark(roleMenu.rowId, roleMenu.markId, asset);
    },
    [onAddFrameRoleMark, onRebindFrameRoleMark, roleMenu]
  );

  const handleCustomName = useCallback(
    (name: string) => {
      if (!roleMenu) return;
      if (roleMenu.mode === 'add') {
        if (!onAddFrameRoleMark) return;
        onAddFrameRoleMark(roleMenu.rowId, {
          name,
          x: roleMenu.normX,
          y: roleMenu.normY,
        });
        return;
      }
      if (!roleMenu.markId || !onSetFrameRoleMarkCustomName) return;
      onSetFrameRoleMarkCustomName(roleMenu.rowId, roleMenu.markId, name);
    },
    [onAddFrameRoleMark, onSetFrameRoleMarkCustomName, roleMenu]
  );

  const handleDeleteMark = useCallback(() => {
    if (!roleMenu?.markId || !onRemoveFrameRoleMark) return;
    onRemoveFrameRoleMark(roleMenu.rowId, roleMenu.markId);
    onSelectFrameRoleMark?.(roleMenu.rowId, null);
  }, [onRemoveFrameRoleMark, onSelectFrameRoleMark, roleMenu]);

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
          const rowPassed = storyboardRowIsPassed(row);
          const rowCanEditMarks = canEditMarks && !rowPassed && Boolean(img);
          const roleReplaceEligible = roleReplaceEligibleRowIds?.has(row.id) ?? false;
          const filterActive = filterMatchedRowIds != null;
          const filterMatch = !filterActive || filterMatchedRowIds.has(row.id);
          const filterFlash = filterFlashRowId === row.id;

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
            if (filterActive && filterMatch) {
              return `${STORYBOARD_ROW_IDLE} ring-1 ring-violet-400/45`;
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
              className={`${STORYBOARD_ROW_SHELL} flex min-w-0 cursor-pointer flex-col overflow-hidden text-left transition ${
                filterActive && !filterMatch ? 'opacity-55 hover:opacity-80' : ''
              } ${filterFlash ? 'ring-2 ring-amber-400/55' : ''} ${shellTone}`}
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
                ref={(el) => {
                  frameRefs.current[row.id] = el;
                }}
                className={`relative aspect-[4/3] w-full bg-black/40 ${
                  historyHighlight ? 'ring-2 ring-inset ring-amber-400/50' : ''
                }`}
                onContextMenu={(event) => openAddMenu(event, row)}
                onDragOver={(event) => {
                  if (readOnly || !onAssignImagesFromDrop || rowPassed) return;
                  if (event.dataTransfer.types.includes('Files')) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'copy';
                  }
                }}
                onDrop={(event) => {
                  if (readOnly || !onAssignImagesFromDrop || rowPassed) return;
                  onAssignImagesFromDrop(row.id, event);
                }}
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
                  <StoryboardFrameRoleMarkChip
                    key={mark.id}
                    mark={mark}
                    label={resolveStoryboardFrameRoleMarkDisplayName(mark, roleAssets)}
                    selected={
                      activeRowId === row.id && selectedFrameRoleMarkId === mark.id
                    }
                    replaceHighlight={roleReplaceEligible}
                    readOnly={!rowCanEditMarks}
                    getFrameEl={() => frameRefs.current[row.id] ?? null}
                    onSelect={() => {
                      onSelectRow(row.id);
                      onSelectFrameRoleMark?.(row.id, mark.id);
                    }}
                    onMove={(x, y) => onUpdateFrameRoleMark?.(row.id, mark.id, { x, y })}
                    onContextMenu={(clientX, clientY) =>
                      openEditMenu(row, mark.id, clientX, clientY)
                    }
                  />
                ))}
                {busy ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-[9px] text-gray-200">
                    处理中…
                  </div>
                ) : null}
                {img && onPreviewRowFrame ? (
                  <button
                    type="button"
                    title="放大"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      onPreviewRowFrame(row);
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
        mode={roleMenu?.mode ?? 'add'}
        x={roleMenu?.clientX ?? 0}
        y={roleMenu?.clientY ?? 0}
        roleAssets={roleAssets}
        onPick={handlePickRole}
        onCustomName={
          roleMenu?.mode === 'add'
            ? onAddFrameRoleMark
              ? handleCustomName
              : undefined
            : onSetFrameRoleMarkCustomName
              ? handleCustomName
              : undefined
        }
        onDelete={roleMenu?.mode === 'edit' && onRemoveFrameRoleMark ? handleDeleteMark : undefined}
        onClose={closeRoleMenu}
      />
    </>
  );
}
