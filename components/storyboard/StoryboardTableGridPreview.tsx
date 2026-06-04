import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { StoryboardParseFieldDef, StoryboardTableRow, StoryboardRoleAsset } from '../../types';
import {
  findStoryboardGroupIndexForRow,
  groupStoryboardRowsForGridPreview,
  type StoryboardDurationGroup,
} from '../../services/storyboardGridDurationGroups';
import {
  STORYBOARD_EDIT_ROW_GAP_PX,
  STORYBOARD_VIRTUALIZE_MIN_ROWS,
  storyboardEditGridColumnsForWidth,
  storyboardGridBandCount,
  storyboardGridCompositeBandHeightPx,
} from '../../services/storyboardVirtualScroll';
import StoryboardDurationGroupMosaicCard from './StoryboardDurationGroupMosaicCard';
import {
  STORYBOARD_BODY_SCROLL,
  STORYBOARD_GAP_STACK,
  STORYBOARD_GRID_PREVIEW,
  STORYBOARD_PAD_PANEL,
} from './storyboardTableUi';

type Props = {
  rows: StoryboardTableRow[];
  fieldCatalog?: StoryboardParseFieldDef[];
  secondsPerTile: number;
  timelineLayerCount?: number;
  gridExportWidth?: number;
  overlayRoleMarks?: boolean;
  includeShotText?: boolean;
  roleAssets?: StoryboardRoleAsset[];
  activeRowId: string | null;
  onSelect: (rowId: string) => void;
  onPreviewImage: (src: string) => void;
  onPreviewMosaicError?: (message: string) => void;
  onDownloadGroup?: (group: StoryboardDurationGroup) => void;
  scrollToRowRef?: React.MutableRefObject<((rowId: string) => void) | null>;
};

export default function StoryboardTableGridPreview({
  rows,
  fieldCatalog = [],
  secondsPerTile,
  timelineLayerCount = 1,
  gridExportWidth = 2560,
  overlayRoleMarks = false,
  includeShotText = false,
  roleAssets = [],
  activeRowId,
  onSelect,
  onPreviewImage,
  onPreviewMosaicError,
  onDownloadGroup,
  scrollToRowRef,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(2);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  const groups = useMemo(
    () => groupStoryboardRowsForGridPreview(rows, secondsPerTile, timelineLayerCount),
    [rows, secondsPerTile, timelineLayerCount]
  );

  const virtualize = groups.length >= STORYBOARD_VIRTUALIZE_MIN_ROWS;
  const bandCount = storyboardGridBandCount(groups.length, columns);
  const bandHeight = useMemo(
    () => storyboardGridCompositeBandHeightPx(groups, true),
    [groups]
  );
  const totalHeight = virtualize ? Math.max(0, bandCount * bandHeight - STORYBOARD_EDIT_ROW_GAP_PX) : 0;

  const readLayout = useCallback(() => {
    const grid = gridRef.current;
    const scroll = scrollRef.current;
    if (grid) {
      const cols = storyboardEditGridColumnsForWidth(grid.clientWidth);
      setColumns(Math.min(3, Math.max(1, cols)));
    }
    if (scroll) {
      setScrollTop(scroll.scrollTop);
      setViewportHeight(scroll.clientHeight);
    }
  }, []);

  useLayoutEffect(() => {
    readLayout();
    const grid = gridRef.current;
    const scroll = scrollRef.current;
    if (!grid || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => readLayout());
    ro.observe(grid);
    if (scroll) ro.observe(scroll);
    return () => ro.disconnect();
  }, [groups.length, readLayout]);

  const scrollToRow = useCallback(
    (rowId: string) => {
      const groupIndex = findStoryboardGroupIndexForRow(groups, rowId);
      if (groupIndex < 0 || !scrollRef.current) return;
      const band = Math.floor(groupIndex / Math.max(columns, 1));
      scrollRef.current.scrollTo({ top: band * bandHeight, behavior: 'smooth' });
    },
    [bandHeight, columns, groups]
  );

  React.useEffect(() => {
    if (scrollToRowRef) scrollToRowRef.current = scrollToRow;
    return () => {
      if (scrollToRowRef) scrollToRowRef.current = null;
    };
  }, [scrollToRow, scrollToRowRef]);

  const { startBand, endBand } = useMemo(() => {
    if (!virtualize) return { startBand: 0, endBand: bandCount };
    const overscan = 2;
    const start = Math.max(0, Math.floor(scrollTop / bandHeight) - overscan);
    const end = Math.min(
      bandCount,
      Math.ceil((scrollTop + viewportHeight) / bandHeight) + overscan
    );
    return { startBand: start, endBand: end };
  }, [bandCount, bandHeight, scrollTop, viewportHeight, virtualize]);

  const visibleGroups = useMemo(() => {
    if (!virtualize) return groups;
    const start = startBand * columns;
    const end = Math.min(groups.length, endBand * columns);
    return groups.slice(start, end);
  }, [columns, endBand, groups, startBand, virtualize]);

  const paddingTop = virtualize ? startBand * bandHeight : 0;
  const paddingBottom = virtualize ? Math.max(0, totalHeight - endBand * bandHeight) : 0;

  const renderGroup = (group: StoryboardDurationGroup) => (
    <StoryboardDurationGroupMosaicCard
      key={group.id}
      group={group}
      fieldCatalog={fieldCatalog}
      activeRowId={activeRowId}
      previewWidth={gridExportWidth}
      overlayRoleMarks={overlayRoleMarks}
      includeShotText={includeShotText}
      roleAssets={roleAssets}
      onSelectRow={onSelect}
      onPreviewImage={onPreviewImage}
      onPreviewMosaicError={onPreviewMosaicError}
      onDownloadGroup={onDownloadGroup}
    />
  );

  const gridContent = (
    <div
      ref={gridRef}
      className={`${STORYBOARD_GRID_PREVIEW} grid-cols-[repeat(auto-fill,minmax(11.5rem,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(12.5rem,1fr))] lg:grid-cols-[repeat(auto-fill,minmax(13rem,1fr))]`}
      style={virtualize ? { paddingTop, paddingBottom } : undefined}
    >
      {(virtualize ? visibleGroups : groups).map((group) => renderGroup(group))}
    </div>
  );

  return (
    <div className={`flex min-h-0 flex-1 flex-col overflow-hidden ${STORYBOARD_PAD_PANEL} pt-1`}>
      <div
        ref={scrollRef}
        onScroll={() => readLayout()}
        className={`${STORYBOARD_BODY_SCROLL} min-h-0 flex-1 pb-1`}
      >
        {groups.length === 0 ? (
          <p className="py-12 text-center text-[11px] text-gray-600">暂无镜头</p>
        ) : virtualize ? (
          <div style={{ height: totalHeight, position: 'relative' }}>
            <div className={`absolute inset-x-0 top-0 ${STORYBOARD_GAP_STACK}`}>{gridContent}</div>
          </div>
        ) : (
          gridContent
        )}
      </div>
    </div>
  );
}
