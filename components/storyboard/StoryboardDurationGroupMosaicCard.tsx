import React, { memo, useCallback, useMemo, useRef, useState } from 'react';
import type { StoryboardParseFieldDef } from '../../types';
import type { StoryboardDurationGroup } from '../../services/storyboardGridDurationGroups';
import { renderStoryboardGroupMosaicPreview } from '../../services/storyboardGridMosaicPreview';
import { computeStoryboardMosaicGrid } from '../../services/storyboardFrameStripMerge';
import StoryboardConnectedCompositeCard from './StoryboardConnectedCompositeCard';
import { storyboardGroupCompositeDomId } from './storyboardTableDom';
import { storyboardPanelCardTone, STORYBOARD_ROW_ICON_BTN } from './storyboardTableUi';
import AppIcon from '../ui/AppIcon';

type Props = {
  group: StoryboardDurationGroup;
  fieldCatalog: StoryboardParseFieldDef[];
  activeRowId: string | null;
  previewWidth: number;
  onSelectRow: (rowId: string) => void;
  onPreviewImage: (src: string) => void;
  onPreviewMosaicError?: (message: string) => void;
  onDownloadGroup?: (group: StoryboardDurationGroup) => void;
};

function StoryboardDurationGroupMosaicCard({
  group,
  fieldCatalog,
  activeRowId,
  previewWidth,
  onSelectRow,
  onPreviewImage,
  onPreviewMosaicError,
  onDownloadGroup,
}: Props) {
  const [previewBusy, setPreviewBusy] = useState(false);
  const previewBusyRef = useRef(false);
  const { cols } = useMemo(
    () => computeStoryboardMosaicGrid(group.rows.length),
    [group.rows.length]
  );
  const durationSec = group.totalDurationSec;
  const durationLabel = `${
    Number.isInteger(durationSec) ? durationSec : durationSec.toFixed(1)
  }s${group.hasEstimatedDuration ? '*' : ''}`;
  const showLocked = group.rows.some((r) => r.locked);
  const groupActive = group.rowIds.includes(activeRowId ?? '');

  const handlePreviewMosaic = useCallback(async () => {
    if (previewBusyRef.current) return;
    previewBusyRef.current = true;
    setPreviewBusy(true);
    try {
      const dataUrl = await renderStoryboardGroupMosaicPreview(
        group,
        fieldCatalog,
        previewWidth
      );
      if (dataUrl) {
        onPreviewImage(dataUrl);
      } else {
        onPreviewMosaicError?.('拼图预览生成失败');
      }
    } catch {
      onPreviewMosaicError?.('拼图预览生成失败');
    } finally {
      previewBusyRef.current = false;
      setPreviewBusy(false);
    }
  }, [fieldCatalog, group, onPreviewImage, onPreviewMosaicError, previewWidth]);

  return (
    <article
      id={storyboardGroupCompositeDomId(group.id)}
      className={`scroll-mt-2 flex w-full min-w-0 flex-col overflow-hidden ${storyboardPanelCardTone(groupActive)}`}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] bg-black/25 px-2 py-1.5">
        <button
          type="button"
          onClick={() => group.rowIds[0] && onSelectRow(group.rowIds[0])}
          className="min-w-0 flex-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-violet-500/35"
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-bold text-white/95">{group.shotRangeLabel}</span>
            <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[8px] tabular-nums text-gray-400">
              {durationLabel}
            </span>
            <span className="text-[8px] text-gray-600">{group.rows.length}镜</span>
            {showLocked ? (
              <span className="rounded-md bg-amber-500/25 px-1.5 py-0.5 text-[8px] font-bold text-amber-100">
                锁
              </span>
            ) : null}
          </div>
        </button>
        <button
          type="button"
          title="预览拼图"
          aria-label="预览拼图"
          disabled={previewBusy}
          onClick={(e) => {
            e.stopPropagation();
            void handlePreviewMosaic();
          }}
          className={STORYBOARD_ROW_ICON_BTN}
        >
          <AppIcon
            name="image"
            className={`h-3.5 w-3.5 ${previewBusy ? 'animate-pulse opacity-60' : ''}`}
          />
        </button>
        {onDownloadGroup ? (
          <button
            type="button"
            title="下载本组高清拼图"
            aria-label="下载本组高清拼图"
            onClick={(e) => {
              e.stopPropagation();
              onDownloadGroup(group);
            }}
            className={STORYBOARD_ROW_ICON_BTN}
          >
            <AppIcon name="download" className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      <div
        className="grid gap-1.5 p-1.5"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {group.rows.map((row) => (
          <StoryboardConnectedCompositeCard
            key={row.id}
            row={row}
            index={row.index}
            fieldCatalog={fieldCatalog}
            active={activeRowId === row.id}
            compact
            onSelect={() => onSelectRow(row.id)}
            onPreviewImage={onPreviewImage}
          />
        ))}
      </div>
    </article>
  );
}

function mosaicCardPropsEqual(prev: Props, next: Props): boolean {
  if (prev.activeRowId !== next.activeRowId || prev.previewWidth !== next.previewWidth) {
    return false;
  }
  if (prev.group.id !== next.group.id) return false;
  if (prev.fieldCatalog !== next.fieldCatalog) return false;
  return prev.group.rows === next.group.rows;
}

export default memo(StoryboardDurationGroupMosaicCard, mosaicCardPropsEqual);
