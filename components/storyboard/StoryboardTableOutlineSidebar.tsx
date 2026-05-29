import React, { useMemo } from 'react';
import type { StoryboardParseFieldDef, StoryboardTableRow } from '../../types';
import type { UseStoryboardVirtualListResult } from '../../hooks/useStoryboardVirtualList';
import {
  storyboardRowHasFrameRef,
  resolveStoryboardRowFrameDisplaySrc,
} from '../../services/storyboardFrameImageUrl';
import {
  STORYBOARD_OUTLINE_ROW_ESTIMATE_PX,
  buildStoryboardRowOffsets,
  storyboardScrollOffsetForIndex,
} from '../../services/storyboardVirtualScroll';
import { StoryboardRowMeasureWrap } from './StoryboardRowMeasureWrap';
import {
  storyboardRowOutlineSubtitle,
  storyboardRowOutlineTitle,
} from './storyboardRowDisplay';
import {
  STORYBOARD_COLUMN_HEAD,
  STORYBOARD_OUTLINE_ITEM,
  STORYBOARD_OUTLINE_ITEM_ACTIVE,
  STORYBOARD_OUTLINE_ITEM_IDLE,
  STORYBOARD_BODY_SCROLL,
  STORYBOARD_SIDE_DOCK,
  STORYBOARD_SIDE_RAIL,
} from './storyboardTableUi';

type Props = {
  rows: StoryboardTableRow[];
  fieldCatalog?: StoryboardParseFieldDef[];
  activeRowId: string | null;
  onSelect: (rowId: string) => void;
  virtualList?: UseStoryboardVirtualListResult;
};

function OutlineRowButton({
  row,
  index,
  active,
  fieldCatalog,
  onSelect,
}: {
  row: StoryboardTableRow;
  index: number;
  active: boolean;
  fieldCatalog: StoryboardParseFieldDef[];
  onSelect: () => void;
}) {
  const thumb = resolveStoryboardRowFrameDisplaySrc(row);
  const hasThumb = storyboardRowHasFrameRef(row);
  const title = storyboardRowOutlineTitle(row, index);
  const subtitle = storyboardRowOutlineSubtitle(row, fieldCatalog);

  return (
    <div role="listitem">
      <button
        type="button"
        onClick={onSelect}
        className={`${STORYBOARD_OUTLINE_ITEM} gap-1 rounded-lg px-1 py-0.5 ${
          active ? STORYBOARD_OUTLINE_ITEM_ACTIVE : STORYBOARD_OUTLINE_ITEM_IDLE
        }`}
      >
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md text-[9px] font-bold ${
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
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="flex items-center gap-1">
            <span className="truncate text-[10px] font-semibold text-gray-100">{title}</span>
            {row.locked ? (
              <span className="shrink-0 text-[8px] text-amber-400/90">锁</span>
            ) : null}
          </span>
          <span className="mt-px block truncate text-[8px] text-gray-600">{subtitle}</span>
        </span>
      </button>
    </div>
  );
}

export default function StoryboardTableOutlineSidebar({
  rows,
  fieldCatalog = [],
  activeRowId,
  onSelect,
  virtualList,
}: Props) {
  const virtualize = virtualList?.virtualize ?? false;
  const range = virtualList?.range;
  const offsets = useMemo(() => {
    if (!virtualList || !virtualize) return [];
    const rowIds = rows.map((r) => r.id);
    return buildStoryboardRowOffsets(
      rowIds,
      virtualList.heights,
      STORYBOARD_OUTLINE_ROW_ESTIMATE_PX,
      1
    ).offsets;
  }, [rows, virtualList, virtualize]);

  const visibleRows = useMemo(() => {
    if (!virtualize || !range) return rows;
    return rows.slice(range.startIndex, range.endIndex);
  }, [rows, virtualize, range]);

  const listBody = virtualize && range && virtualList ? (
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
            <OutlineRowButton
              row={row}
              index={row.index}
              active={activeRowId === row.id}
              fieldCatalog={fieldCatalog}
              onSelect={() => onSelect(row.id)}
            />
          </StoryboardRowMeasureWrap>
        );
      })}
    </div>
  ) : (
    <div className="flex flex-col gap-px" role="list">
      {rows.map((row, i) => (
        <OutlineRowButton
          key={row.id}
          row={row}
          index={i}
          active={activeRowId === row.id}
          fieldCatalog={fieldCatalog}
          onSelect={() => onSelect(row.id)}
        />
      ))}
    </div>
  );

  return (
    <aside className={`${STORYBOARD_SIDE_RAIL} w-full min-w-0`}>
      <div className={`${STORYBOARD_SIDE_DOCK} flex h-full min-h-0 flex-col`}>
        <div className="shrink-0 border-b border-white/[0.06] px-2 py-1">
          <p className={`${STORYBOARD_COLUMN_HEAD} !mb-0 text-[9px]`}>
            大纲 <span className="font-normal text-gray-600">· {rows.length}</span>
          </p>
        </div>
        <nav
          ref={virtualList?.scrollRef}
          onScroll={virtualize ? virtualList?.handleScroll : undefined}
          className={`${STORYBOARD_BODY_SCROLL} p-0.5`}
          aria-label="分镜大纲"
        >
          {listBody}
        </nav>
      </div>
    </aside>
  );
}
