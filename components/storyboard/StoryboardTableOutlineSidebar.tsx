import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { StoryboardParseFieldDef, StoryboardTableRow } from '../../types';
import type { UseStoryboardVirtualListResult } from '../../hooks/useStoryboardVirtualList';
import { readLocalJson, writeLocalJson } from '../../services/clientPersist';
import type { StoryboardGeneratedAssetItem } from '../../services/storyboardGeneratedAssets';
import {
  storyboardRowHasFrameRef,
  resolveStoryboardRowFrameDisplaySrc,
} from '../../services/storyboardFrameImageUrl';
import {
  STORYBOARD_OUTLINE_ROW_ESTIMATE_PX,
  buildStoryboardRowOffsets,
  storyboardScrollOffsetForIndex,
} from '../../services/storyboardVirtualScroll';
import { computeStoryboardOutlineDropIndex } from '../../services/storyboardTableAsset';
import { StoryboardRowMeasureWrap } from './StoryboardRowMeasureWrap';
import {
  storyboardRowEditFeedbackPreview,
  storyboardRowOutlineSubtitle,
  storyboardRowOutlineTitle,
} from './storyboardRowDisplay';
import {
  storyboardEditCanvasFilterAccentClass,
  type StoryboardEditCanvasFilterPill,
} from '../../services/storyboardEditCanvasFilter';
import StoryboardEditFeedbackMark from './StoryboardEditFeedbackMark';
import WorkflowPixelBusyOverlay from '../WorkflowPixelBusyOverlay';
import StoryboardOutlineContextMenu from './StoryboardOutlineContextMenu';
import StoryboardOutlineGenHistoryGrid from './StoryboardOutlineGenHistoryGrid';
import type { StoryboardCanvasSelectModifiers } from './StoryboardEditCanvasGrid';
import {
  STORYBOARD_COLUMN_HEAD,
  STORYBOARD_OUTLINE_ITEM,
  STORYBOARD_OUTLINE_ITEM_ACTIVE,
  STORYBOARD_OUTLINE_ITEM_IDLE,
  STORYBOARD_BODY_SCROLL,
  STORYBOARD_ROW_CANVAS_MULTI_SELECTED,
  STORYBOARD_SIDE_DOCK,
  STORYBOARD_SIDE_RAIL,
  STORYBOARD_VIEW_TOGGLE,
  STORYBOARD_VIEW_TOGGLE_ACTIVE,
  STORYBOARD_VIEW_TOGGLE_BTN,
  STORYBOARD_VIEW_TOGGLE_IDLE,
  storyboardCollageProcessingBadgeClass,
  storyboardCollageProcessingDetail,
  storyboardCollageProcessingLabel,
  storyboardCollageQueuedBadgeClass,
  type StoryboardCollageProcessingKind,
} from './storyboardTableUi';

const OUTLINE_DRAG_MIME = 'application/x-ac-storyboard-outline-row';

export type StoryboardOutlineSidePanel = 'outline' | 'genHistory';

function outlineSidePanelStorageKey(assetId: string): string {
  return `ac_storyboard_outline_side_panel_v1:${assetId}`;
}

type Props = {
  assetId: string;
  rows: StoryboardTableRow[];
  generatedImageAssets?: StoryboardGeneratedAssetItem[];
  onPreviewGeneratedImage?: (src: string) => void;
  onGenHistoryPanelVisible?: () => void;
  onGeneratedImageHistoryLoadError?: () => void;
  fieldCatalog?: StoryboardParseFieldDef[];
  activeRowId: string | null;
  selectedRowIds?: ReadonlySet<string>;
  readOnly?: boolean;
  onSelect: (rowId: string, modifiers?: StoryboardCanvasSelectModifiers) => void;
  onReorder?: (fromIndex: number, toIndex: number) => void;
  onInsertShotBefore?: (rowIndex: number) => void;
  onInsertShotAfter?: (rowIndex: number) => void;
  virtualList?: UseStoryboardVirtualListResult;
  filterMatchedRowIds?: ReadonlySet<string> | null;
  filterPill?: StoryboardEditCanvasFilterPill;
  outlineFlashRowId?: string | null;
  collageProcessingRowIds?: ReadonlySet<string>;
  collageProcessingQueuedRowIds?: ReadonlySet<string>;
  collageProcessingKind?: StoryboardCollageProcessingKind | null;
};

function OutlineRowButton({
  row,
  index,
  active,
  multiSelected,
  fieldCatalog,
  readOnly,
  reorderActive,
  dragging,
  showDropBefore,
  onSelect,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onContextMenu,
  filterMatch = true,
  filterAccentClass = '',
  flash = false,
  collageProcessing = false,
  collageQueued = false,
  collageProcessingKind = null,
}: {
  row: StoryboardTableRow;
  index: number;
  active: boolean;
  multiSelected: boolean;
  fieldCatalog: StoryboardParseFieldDef[];
  readOnly: boolean;
  reorderActive: boolean;
  dragging: boolean;
  showDropBefore: boolean;
  onSelect: (modifiers?: StoryboardCanvasSelectModifiers) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: (clientY: number, rect: DOMRect) => void;
  onDrop: () => void;
  onContextMenu?: (event: React.MouseEvent) => void;
  filterMatch?: boolean;
  filterAccentClass?: string;
  flash?: boolean;
  collageProcessing?: boolean;
  collageQueued?: boolean;
  collageProcessingKind?: StoryboardCollageProcessingKind | null;
}) {
  const dragStartedRef = useRef(false);
  const suppressClickRef = useRef(false);
  const thumb = resolveStoryboardRowFrameDisplaySrc(row);
  const hasThumb = storyboardRowHasFrameRef(row);
  const title = storyboardRowOutlineTitle(row, index);
  const feedbackPreview = storyboardRowEditFeedbackPreview(row);
  const subtitle = feedbackPreview ?? storyboardRowOutlineSubtitle(row, fieldCatalog);

  const shellClass = active
    ? STORYBOARD_OUTLINE_ITEM_ACTIVE
    : multiSelected
      ? STORYBOARD_ROW_CANVAS_MULTI_SELECTED
      : STORYBOARD_OUTLINE_ITEM_IDLE;

  return (
    <div
      role="listitem"
      className={`relative overflow-hidden rounded-lg ${filterMatch ? '' : 'opacity-50'} ${
        flash ? 'ring-1 ring-amber-400/50' : ''
      }`}
    >
      {showDropBefore ? (
        <div
          aria-hidden
          className="pointer-events-none absolute -top-px left-1 right-1 z-10 h-0.5 rounded-full bg-teal-300/90 shadow-[0_0_6px_rgba(45,212,191,0.45)]"
        />
      ) : null}
      <div
        draggable={!readOnly}
        onDragStart={(event) => {
          if (readOnly) {
            event.preventDefault();
            return;
          }
          suppressClickRef.current = true;
          dragStartedRef.current = true;
          onDragStart();
          event.dataTransfer.setData(OUTLINE_DRAG_MIME, row.id);
          event.dataTransfer.effectAllowed = 'move';
        }}
        onDragEnd={() => {
          dragStartedRef.current = false;
          onDragEnd();
        }}
        onDragOver={(event) => {
          if (readOnly || !reorderActive) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          onDragOver(event.clientY, event.currentTarget.getBoundingClientRect());
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onDrop();
        }}
        onContextMenu={(event) => {
          if (readOnly) return;
          event.preventDefault();
          event.stopPropagation();
          onContextMenu?.(event);
        }}
        onClick={(event) => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
          }
          if (dragStartedRef.current) {
            dragStartedRef.current = false;
            return;
          }
          onSelect({
            additive: event.ctrlKey || event.metaKey,
            range: event.shiftKey,
          });
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          onSelect();
        }}
        className={`${STORYBOARD_OUTLINE_ITEM} relative gap-1 rounded-lg px-1 py-0.5 ${shellClass} ${
          dragging ? 'opacity-45' : ''
        } ${readOnly ? '' : 'cursor-grab active:cursor-grabbing'}`}
      >
        {filterAccentClass ? (
          <span
            aria-hidden
            className={`absolute bottom-1 left-0 top-1 w-0.5 rounded-full ${filterAccentClass}`}
          />
        ) : null}
        <span
          className={`relative flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md text-[9px] font-bold ${
            hasThumb ? 'bg-black/25 ring-1 ring-white/[0.08]' : 'bg-white/[0.04] text-gray-500'
          }`}
        >
          {thumb ? (
            <img src={thumb} alt="" className="h-full w-full object-cover" draggable={false} loading="lazy" />
          ) : hasThumb ? (
            <span className="text-[8px] text-gray-500">图</span>
          ) : (
            title
          )}
          {collageProcessing && collageProcessingKind ? (
            <WorkflowPixelBusyOverlay
              executing
              accentExecuting
              density="compact"
              progressDetail={storyboardCollageProcessingDetail(collageProcessingKind)}
              className="rounded-md"
            />
          ) : collageQueued && collageProcessingKind ? (
            <div className="absolute inset-0 flex items-center justify-center rounded-md bg-black/50 text-[7px] font-medium text-gray-300">
              等待
            </div>
          ) : null}
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="flex items-center gap-1">
            <span className="truncate text-[10px] font-semibold text-gray-100">{title}</span>
            {row.locked ? (
              <span className="shrink-0 text-[8px] text-amber-400/90">过</span>
            ) : null}
            {collageProcessing && collageProcessingKind ? (
              <span
                className={`shrink-0 rounded px-1 py-px text-[7px] font-semibold ring-1 ${storyboardCollageProcessingBadgeClass(collageProcessingKind)}`}
              >
                {storyboardCollageProcessingLabel(collageProcessingKind)}
              </span>
            ) : collageQueued && collageProcessingKind ? (
              <span
                className={`shrink-0 rounded px-1 py-px text-[7px] font-semibold ring-1 ${storyboardCollageQueuedBadgeClass(collageProcessingKind)}`}
              >
                等待中
              </span>
            ) : (
              <StoryboardEditFeedbackMark row={row} />
            )}
          </span>
          <span
            className={`mt-px block truncate text-[8px] ${
              feedbackPreview ? 'text-sky-300/80' : 'text-gray-600'
            }`}
          >
            {feedbackPreview ? `反馈：${subtitle}` : subtitle}
          </span>
        </span>
      </div>
    </div>
  );
}

export default function StoryboardTableOutlineSidebar({
  assetId,
  rows,
  generatedImageAssets = [],
  onPreviewGeneratedImage,
  onGenHistoryPanelVisible,
  onGeneratedImageHistoryLoadError,
  fieldCatalog = [],
  activeRowId,
  selectedRowIds,
  readOnly = false,
  onSelect,
  onReorder,
  onInsertShotBefore,
  onInsertShotAfter,
  virtualList,
  filterMatchedRowIds = null,
  filterPill = 'all',
  outlineFlashRowId = null,
  collageProcessingRowIds,
  collageProcessingQueuedRowIds,
  collageProcessingKind = null,
}: Props) {
  const [sidePanel, setSidePanel] = useState<StoryboardOutlineSidePanel>(() =>
    readLocalJson(outlineSidePanelStorageKey(assetId), 'outline', (value) =>
      value === 'outline' || value === 'genHistory' ? value : null
    )
  );

  useEffect(() => {
    writeLocalJson(outlineSidePanelStorageKey(assetId), sidePanel);
  }, [assetId, sidePanel]);

  useEffect(() => {
    if (sidePanel !== 'genHistory') return;
    onGenHistoryPanelVisible?.();
  }, [onGenHistoryPanelVisible, sidePanel]);

  const virtualize = virtualList?.virtualize ?? false;
  const range = virtualList?.range;
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dropHintIndex, setDropHintIndex] = useState<number | null>(null);
  const [outlineMenu, setOutlineMenu] = useState<{
    rowIndex: number;
    x: number;
    y: number;
  } | null>(null);
  const dragFromRef = useRef<number | null>(null);
  const dropToRef = useRef<number | null>(null);

  const offsets = React.useMemo(() => {
    if (!virtualList || !virtualize) return [];
    const rowIds = rows.map((r) => r.id);
    return buildStoryboardRowOffsets(
      rowIds,
      virtualList.heights,
      STORYBOARD_OUTLINE_ROW_ESTIMATE_PX,
      1
    ).offsets;
  }, [rows, virtualList, virtualize]);

  const visibleRows = React.useMemo(() => {
    if (!virtualize || !range) return rows;
    return rows.slice(range.startIndex, range.endIndex);
  }, [rows, virtualize, range]);

  const filterActive = filterMatchedRowIds != null;
  const filterAccent =
    filterPill !== 'all' ? storyboardEditCanvasFilterAccentClass(filterPill) : '';

  const clearDrag = useCallback(() => {
    dragFromRef.current = null;
    dropToRef.current = null;
    setDraggingIndex(null);
    setDropHintIndex(null);
  }, []);

  const handleDrop = useCallback(() => {
    if (readOnly || !onReorder) {
      clearDrag();
      return;
    }
    const from = dragFromRef.current;
    const to = dropToRef.current;
    if (from != null && to != null && from !== to) {
      onReorder(from, to);
    }
    clearDrag();
  }, [clearDrag, onReorder, readOnly]);

  const syncDropHint = useCallback(
    (index: number, clientY: number, rect: DOMRect) => {
      if (dragFromRef.current == null) return;
      const to = computeStoryboardOutlineDropIndex(
        dragFromRef.current,
        index,
        clientY,
        rect,
        rows.length
      );
      dropToRef.current = to;
      setDropHintIndex(to);
    },
    [rows.length]
  );

  const outlineRowProps = (row: StoryboardTableRow, index: number) => {
    const filterMatch = !filterActive || filterMatchedRowIds.has(row.id);
    const selected = selectedRowIds?.has(row.id) ?? false;
    return {
      row,
      index,
      active: activeRowId === row.id,
      multiSelected: selected && activeRowId !== row.id,
      fieldCatalog,
      readOnly,
      reorderActive: draggingIndex != null,
      dragging: draggingIndex === index,
      showDropBefore: dropHintIndex === index && draggingIndex != null && draggingIndex !== index,
      onSelect: (modifiers?: StoryboardCanvasSelectModifiers) => onSelect(row.id, modifiers),
      onDragStart: () => {
        dragFromRef.current = index;
        dropToRef.current = index;
        setDraggingIndex(index);
        setDropHintIndex(index);
      },
      onDragEnd: () => {
        window.setTimeout(() => clearDrag(), 0);
      },
      onDragOver: (clientY: number, rect: DOMRect) => {
        syncDropHint(index, clientY, rect);
      },
      onDrop: handleDrop,
      onContextMenu:
        !readOnly && onInsertShotBefore && onInsertShotAfter
          ? (event: React.MouseEvent) => {
              onSelect(row.id);
              setOutlineMenu({
                rowIndex: index,
                x: event.clientX,
                y: event.clientY,
              });
            }
          : undefined,
      filterMatch,
      filterAccentClass: filterMatch && filterAccent ? filterAccent : '',
      flash: outlineFlashRowId === row.id,
      collageProcessing:
        collageProcessingKind != null && (collageProcessingRowIds?.has(row.id) ?? false),
      collageQueued:
        collageProcessingKind != null &&
        !(collageProcessingRowIds?.has(row.id) ?? false) &&
        (collageProcessingQueuedRowIds?.has(row.id) ?? false),
      collageProcessingKind,
    };
  };

  const listBody =
    virtualize && range && virtualList ? (
      <div className="relative w-full" style={{ height: range.totalHeight }}>
        {visibleRows.map((row) => {
          const top = storyboardScrollOffsetForIndex(row.index, offsets);
          return (
            <StoryboardRowMeasureWrap
              key={row.id}
              rowId={row.id}
              measureRow={virtualList.measureRow}
              className="absolute left-0 right-0"
              style={{ top }}
            >
              <OutlineRowButton {...outlineRowProps(row, row.index)} />
            </StoryboardRowMeasureWrap>
          );
        })}
      </div>
    ) : (
      <div className="flex flex-col gap-px" role="list">
        {rows.map((row, i) => (
          <OutlineRowButton key={row.id} {...outlineRowProps(row, i)} />
        ))}
      </div>
    );

  return (
    <>
      <aside className={`${STORYBOARD_SIDE_RAIL} w-full min-w-0`}>
      <div className={`${STORYBOARD_SIDE_DOCK} flex h-full min-h-0 flex-col`}>
        <div className="shrink-0 space-y-1.5 border-b border-white/[0.06] px-2 py-1">
          <div className={STORYBOARD_VIEW_TOGGLE} role="group" aria-label="大纲侧栏视图">
            <button
              type="button"
              className={`${STORYBOARD_VIEW_TOGGLE_BTN} ${
                sidePanel === 'outline' ? STORYBOARD_VIEW_TOGGLE_ACTIVE : STORYBOARD_VIEW_TOGGLE_IDLE
              }`}
              aria-pressed={sidePanel === 'outline'}
              onClick={() => setSidePanel('outline')}
            >
              镜头
            </button>
            <button
              type="button"
              className={`${STORYBOARD_VIEW_TOGGLE_BTN} ${
                sidePanel === 'genHistory' ? STORYBOARD_VIEW_TOGGLE_ACTIVE : STORYBOARD_VIEW_TOGGLE_IDLE
              }`}
              aria-pressed={sidePanel === 'genHistory'}
              onClick={() => setSidePanel('genHistory')}
            >
              生图历史
              {generatedImageAssets.length > 0 ? (
                <span className="ml-1 tabular-nums text-gray-500">{generatedImageAssets.length}</span>
              ) : null}
            </button>
          </div>
          <p className={`${STORYBOARD_COLUMN_HEAD} !mb-0 text-[9px]`}>
            {sidePanel === 'outline' ? (
              <>
                大纲 <span className="font-normal text-gray-600">· {rows.length}</span>
              </>
            ) : (
              <>
                生图历史{' '}
                <span className="font-normal text-gray-600">· {generatedImageAssets.length}</span>
              </>
            )}
          </p>
          {sidePanel === 'genHistory' ? (
            <p className="text-[8px] leading-snug text-gray-600">拖到分镜图/角色参考等图片输入区</p>
          ) : null}
        </div>
        <nav
          ref={virtualList?.scrollRef}
          onScroll={sidePanel === 'outline' && virtualize ? virtualList?.handleScroll : undefined}
          onDragOver={(event) => {
            if (sidePanel !== 'outline' || readOnly || dragFromRef.current == null) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
          }}
          onDrop={(event) => {
            if (sidePanel !== 'outline') return;
            event.preventDefault();
            handleDrop();
          }}
          className={`${STORYBOARD_BODY_SCROLL} p-0.5`}
          aria-label={sidePanel === 'outline' ? '分镜大纲' : '生图历史'}
        >
          <div className={sidePanel === 'genHistory' ? '' : 'hidden'}>
            <StoryboardOutlineGenHistoryGrid
              assets={generatedImageAssets}
              onPreview={
                onPreviewGeneratedImage
                  ? (src, label) => onPreviewGeneratedImage(src)
                  : undefined
              }
              onImageLoadError={onGeneratedImageHistoryLoadError}
            />
          </div>
          <div className={sidePanel === 'outline' ? '' : 'hidden'}>{listBody}</div>
        </nav>
      </div>
    </aside>
      {!readOnly && onInsertShotBefore && onInsertShotAfter ? (
        <StoryboardOutlineContextMenu
          open={outlineMenu != null}
          x={outlineMenu?.x ?? 0}
          y={outlineMenu?.y ?? 0}
          onClose={() => setOutlineMenu(null)}
          onInsertBefore={() => {
            if (outlineMenu == null) return;
            onInsertShotBefore(outlineMenu.rowIndex);
          }}
          onInsertAfter={() => {
            if (outlineMenu == null) return;
            onInsertShotAfter(outlineMenu.rowIndex);
          }}
        />
      ) : null}
    </>
  );
}
