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
import {
  collectStoryboardDuplicateShotRowIds,
  findDuplicateStoryboardShotNos,
} from '../../services/storyboardTableParse';
import { StoryboardRowMeasureWrap } from './StoryboardRowMeasureWrap';
import {
  storyboardRowEditFeedbackPreview,
  storyboardRowHasAssignedShotNo,
  storyboardRowOutlineSubtitle,
  storyboardRowOutlineTitle,
} from './storyboardRowDisplay';
import {
  storyboardEditCanvasFilterAccentClass,
  type StoryboardEditCanvasFilterPill,
} from '../../services/storyboardEditCanvasFilter';
import StoryboardEditFeedbackMark from './StoryboardEditFeedbackMark';
import {
  STORYBOARD_COLUMN_HEAD,
  STORYBOARD_OUTLINE_ITEM,
  STORYBOARD_OUTLINE_ITEM_ACTIVE,
  STORYBOARD_OUTLINE_ITEM_IDLE,
  STORYBOARD_OUTLINE_ITEM_UNNUMBERED,
  STORYBOARD_OUTLINE_ITEM_DUPLICATE,
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
  filterMatchedRowIds?: ReadonlySet<string> | null;
  filterPill?: StoryboardEditCanvasFilterPill;
  outlineFlashRowId?: string | null;
};

function OutlineRowButton({
  row,
  index,
  active,
  duplicate,
  fieldCatalog,
  onSelect,
  filterMatch = true,
  filterAccentClass = '',
  flash = false,
}: {
  row: StoryboardTableRow;
  index: number;
  active: boolean;
  duplicate: boolean;
  fieldCatalog: StoryboardParseFieldDef[];
  onSelect: () => void;
  filterMatch?: boolean;
  filterAccentClass?: string;
  flash?: boolean;
}) {
  const thumb = resolveStoryboardRowFrameDisplaySrc(row);
  const hasThumb = storyboardRowHasFrameRef(row);
  const title = storyboardRowOutlineTitle(row, index);
  const feedbackPreview = storyboardRowEditFeedbackPreview(row);
  const subtitle = feedbackPreview ?? storyboardRowOutlineSubtitle(row, fieldCatalog);
  const unnumbered = !storyboardRowHasAssignedShotNo(row);

  return (
    <div
      role="listitem"
      className={`${filterMatch ? '' : 'opacity-50'} ${flash ? 'rounded-lg ring-1 ring-amber-400/50' : ''}`}
    >
      <button
        type="button"
        onClick={onSelect}
        className={`${STORYBOARD_OUTLINE_ITEM} relative gap-1 rounded-lg px-1 py-0.5 ${
          active
            ? STORYBOARD_OUTLINE_ITEM_ACTIVE
            : duplicate
              ? STORYBOARD_OUTLINE_ITEM_DUPLICATE
              : unnumbered
                ? STORYBOARD_OUTLINE_ITEM_UNNUMBERED
                : STORYBOARD_OUTLINE_ITEM_IDLE
        }`}
      >
        {filterAccentClass ? (
          <span
            aria-hidden
            className={`absolute bottom-1 left-0 top-1 w-0.5 rounded-full ${filterAccentClass}`}
          />
        ) : null}
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md text-[9px] font-bold ${
            hasThumb
              ? 'bg-black/25 ring-1 ring-white/[0.08]'
              : unnumbered
                ? 'bg-amber-500/15 text-amber-200/90 ring-1 ring-amber-500/25'
                : 'bg-white/[0.04] text-gray-500'
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
            <span
              className={`truncate text-[10px] font-semibold ${
                unnumbered ? 'text-amber-100/95' : 'text-gray-100'
              }`}
            >
              {title}
            </span>
            {unnumbered ? (
              <span className="shrink-0 rounded bg-amber-500/20 px-1 py-px text-[7px] font-semibold text-amber-200/90">
                待编号
              </span>
            ) : null}
            {duplicate ? (
              <span className="shrink-0 rounded bg-rose-500/25 px-1 py-px text-[7px] font-semibold text-rose-200/95">
                重复
              </span>
            ) : null}
            {row.locked ? (
              <span className="shrink-0 text-[8px] text-amber-400/90">过</span>
            ) : null}
            <StoryboardEditFeedbackMark row={row} />
          </span>
          <span
            className={`mt-px block truncate text-[8px] ${
              feedbackPreview ? 'text-sky-300/80' : 'text-gray-600'
            }`}
          >
            {feedbackPreview ? `反馈：${subtitle}` : subtitle}
          </span>
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
  filterMatchedRowIds = null,
  filterPill = 'all',
  outlineFlashRowId = null,
}: Props) {
  const virtualize = virtualList?.virtualize ?? false;
  const range = virtualList?.range;
  const duplicateRowIds = useMemo(() => collectStoryboardDuplicateShotRowIds(rows), [rows]);
  const duplicateShotLabels = useMemo(
    () => findDuplicateStoryboardShotNos(rows.map((row) => row.shotNo ?? '')),
    [rows]
  );
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

  const filterActive = filterMatchedRowIds != null;
  const filterAccent =
    filterPill !== 'all' ? storyboardEditCanvasFilterAccentClass(filterPill) : '';

  const outlineRowProps = (row: StoryboardTableRow, index: number) => {
    const filterMatch = !filterActive || filterMatchedRowIds.has(row.id);
    return {
      row,
      index,
      active: activeRowId === row.id,
      duplicate: duplicateRowIds.has(row.id),
      fieldCatalog,
      onSelect: () => onSelect(row.id),
      filterMatch,
      filterAccentClass: filterMatch && filterAccent ? filterAccent : '',
      flash: outlineFlashRowId === row.id,
    };
  };

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
    <aside className={`${STORYBOARD_SIDE_RAIL} w-full min-w-0`}>
      <div className={`${STORYBOARD_SIDE_DOCK} flex h-full min-h-0 flex-col`}>
        <div className="shrink-0 border-b border-white/[0.06] px-2 py-1">
          <p className={`${STORYBOARD_COLUMN_HEAD} !mb-0 text-[9px]`}>
            大纲 <span className="font-normal text-gray-600">· {rows.length}</span>
          </p>
          {duplicateShotLabels.length ? (
            <p
              className="mt-1 rounded-md border border-rose-500/35 bg-rose-500/10 px-1.5 py-1 text-[8px] leading-snug text-rose-200/90"
              title={`重复镜号：${duplicateShotLabels.join('、')}`}
            >
              镜号重复：{duplicateShotLabels.join('、')}
            </p>
          ) : null}
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
