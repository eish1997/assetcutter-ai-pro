import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { StoryboardVideoLayer, StoryboardVideoSegment } from '../../services/storyboardVideoTimeline';
import {
  STORYBOARD_TIMELINE_LAYER_MAX,
  storyboardTimelineDropIndex,
  storyboardTimelineTimeFromClientX,
} from '../../services/storyboardVideoTimeline';
import {
  storyboardTimelineClipRenderMode,
  type StoryboardTimelineClipRenderMode,
} from '../../services/storyboardVirtualScroll';
import {
  STORYBOARD_GAP_TIGHT,
  STORYBOARD_ROW_SHELL,
  STORYBOARD_TOOL_BTN_GHOST,
} from './storyboardTableUi';

const DRAG_MIME = 'application/x-ac-storyboard-row';

type SegmentLayout = {
  seg: StoryboardVideoSegment;
  index: number;
  leftPct: number;
  widthPct: number;
  widthPx: number;
  mode: StoryboardTimelineClipRenderMode;
};

function buildSegmentLayouts(
  segments: StoryboardVideoSegment[],
  globalDuration: number,
  trackWidthPx: number,
  activeRowId: string | null,
  draggingIndex: number | null
): SegmentLayout[] {
  let cursorSec = 0;
  const out: SegmentLayout[] = [];
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i]!;
    const leftPct = globalDuration > 0 ? (cursorSec / globalDuration) * 100 : 0;
    const widthPct = globalDuration > 0 ? (seg.durationSec / globalDuration) * 100 : 0;
    const widthPx = trackWidthPx > 0 ? (widthPct / 100) * trackWidthPx : 0;
    cursorSec += seg.durationSec;
    out.push({
      seg,
      index: i,
      leftPct,
      widthPct,
      widthPx,
      mode: storyboardTimelineClipRenderMode(widthPx, {
        active: activeRowId === seg.rowId,
        dragging: draggingIndex === i,
        segmentCount: segments.length,
      }),
    });
  }
  return out;
}

type TrackProps = {
  layer: number;
  segments: StoryboardVideoSegment[];
  globalDuration: number;
  activeRowId: string | null;
  readOnly: boolean;
  draggingIndex: number | null;
  dropHintIndex: number | null;
  axisRef?: React.RefObject<HTMLDivElement | null>;
  onSelectRow: (rowId: string) => void;
  onDragStart: (layer: number, index: number) => void;
  onDragEnd: () => void;
  onDragOver: (layer: number, clientX: number) => void;
};

function TimelineClipBody({
  seg,
  mode,
}: {
  seg: StoryboardVideoSegment;
  mode: StoryboardTimelineClipRenderMode;
}) {
  if (mode === 'bar') {
    return (
      <div className="h-full w-full bg-white/[0.06]" title={seg.shotNo} aria-hidden />
    );
  }

  if (mode === 'compact' || !seg.frameImage) {
    return (
      <div className="flex h-full items-center justify-center bg-black/40 text-[8px] font-bold text-gray-500">
        {seg.shotNo}
      </div>
    );
  }

  return (
    <>
      <img
        src={seg.frameImage}
        alt=""
        loading="lazy"
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover object-center"
        draggable={false}
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-1 pb-0.5 pt-2">
        <span className="truncate text-[8px] font-bold text-white/95">{seg.shotNo}</span>
      </div>
    </>
  );
}

function TimelineTrack({
  layer,
  segments,
  globalDuration,
  activeRowId,
  readOnly,
  draggingIndex,
  dropHintIndex,
  axisRef,
  onSelectRow,
  onDragStart,
  onDragEnd,
  onDragOver,
}: TrackProps) {
  const localAxisRef = useRef<HTMLDivElement>(null);
  const mergedRef = axisRef ?? localAxisRef;
  const [trackWidthPx, setTrackWidthPx] = useState(0);

  useLayoutEffect(() => {
    const el = mergedRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setTrackWidthPx(el.clientWidth));
    ro.observe(el);
    setTrackWidthPx(el.clientWidth);
    return () => ro.disconnect();
  }, [mergedRef]);

  const layouts = useMemo(
    () => buildSegmentLayouts(segments, globalDuration, trackWidthPx, activeRowId, draggingIndex),
    [activeRowId, draggingIndex, globalDuration, segments, trackWidthPx]
  );

  return (
    <div className="flex min-h-0 flex-1 items-stretch gap-1">
      <div
        className="flex w-7 shrink-0 items-center justify-center text-[8px] font-bold tabular-nums text-gray-500"
        title={`轨道 L${layer}`}
      >
        L{layer}
      </div>
      <div
        ref={mergedRef}
        className="relative flex h-full min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg bg-black/25 ring-1 ring-white/[0.05]"
        onDragOver={(e) => {
          if (readOnly || draggingIndex == null) return;
          e.preventDefault();
          onDragOver(layer, e.clientX);
        }}
      >
        {segments.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[9px] text-gray-600">空轨道</div>
        ) : (
          layouts.map(({ seg, index: i, leftPct, widthPct, mode }) => {
            const active = activeRowId === seg.rowId;
            const isDragging = draggingIndex === i;
            const showDropBefore =
              dropHintIndex === i && draggingIndex != null && draggingIndex !== i;

            return (
              <React.Fragment key={seg.rowId}>
                {showDropBefore ? (
                  <div
                    className="pointer-events-none absolute inset-y-0 z-20 w-1 -translate-x-1/2 bg-white/80 shadow-[0_0_8px_rgba(255,255,255,0.35)]"
                    style={{ left: `${leftPct}%` }}
                  />
                ) : null}
                <div
                  data-timeline-clip
                  draggable={!readOnly}
                  onDragStart={(e) => {
                    if (readOnly) return;
                    onDragStart(layer, i);
                    e.dataTransfer.setData(DRAG_MIME, seg.rowId);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragEnd={onDragEnd}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectRow(seg.rowId);
                  }}
                  style={{
                    left: `${leftPct}%`,
                    width: `${widthPct}%`,
                  }}
                  className={`group absolute inset-y-0 flex min-w-0 flex-col overflow-hidden border-r border-white/[0.06] transition-opacity last:border-r-0 ${
                    isDragging ? 'z-10 opacity-40' : 'z-0 opacity-100'
                  } ${active ? 'bg-white/[0.06] ring-1 ring-inset ring-white/18' : 'hover:bg-white/[0.03]'}`}
                  title={`${seg.shotNo} · ${seg.durationSec.toFixed(1)}s`}
                >
                  <div className="relative min-h-0 flex-1 overflow-hidden bg-black/40">
                    <TimelineClipBody seg={seg} mode={mode} />
                  </div>
                  {mode !== 'bar' ? (
                    <div
                      className={`flex h-3.5 shrink-0 items-center justify-between ${STORYBOARD_GAP_TIGHT} px-1`}
                    >
                      <span className="truncate text-[7px] text-gray-500">
                        {seg.durationSec.toFixed(1)}s{seg.durationIsEstimated ? '*' : ''}
                      </span>
                    </div>
                  ) : null}
                </div>
              </React.Fragment>
            );
          })
        )}
      </div>
    </div>
  );
}

type Props = {
  layers: StoryboardVideoLayer[];
  timelineLayerCount: number;
  activeRowId: string | null;
  playheadTime: number;
  totalDuration: number;
  readOnly?: boolean;
  onSelectRow: (rowId: string) => void;
  onSeek: (timeSec: number) => void;
  onReorderLayer: (layer: number, fromIndex: number, toIndex: number) => void;
  onAddLayer: () => void;
  onRemoveLayer: () => void;
};

export default function StoryboardVideoTimeline({
  layers,
  timelineLayerCount,
  activeRowId,
  playheadTime,
  totalDuration,
  readOnly = false,
  onSelectRow,
  onSeek,
  onReorderLayer,
  onAddLayer,
  onRemoveLayer,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const axisRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<{ layer: number; index: number } | null>(null);
  const [dropHint, setDropHint] = useState<{ layer: number; index: number } | null>(null);

  const seekFromClientX = useCallback(
    (clientX: number) => {
      const el = axisRef.current;
      if (!el || totalDuration <= 0) return;
      onSeek(storyboardTimelineTimeFromClientX(clientX, el.getBoundingClientRect(), totalDuration));
    },
    [onSeek, totalDuration]
  );

  const handleScrollAreaClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (totalDuration <= 0) return;
      if ((e.target as HTMLElement).closest('[data-timeline-clip]')) return;
      seekFromClientX(e.clientX);
    },
    [seekFromClientX, totalDuration]
  );

  const resolveDropIndex = useCallback(
    (layer: number, clientX: number, fromIndex: number) => {
      const layerData = layers.find((l) => l.layer === layer);
      const el = axisRef.current;
      if (!layerData || !el) return fromIndex;
      return storyboardTimelineDropIndex(
        clientX,
        el.getBoundingClientRect(),
        layerData.segments.length,
        layerData.segments.map((s) => s.durationSec),
        fromIndex,
        totalDuration
      );
    },
    [layers, totalDuration]
  );

  const playheadPct = totalDuration > 0 ? (playheadTime / totalDuration) * 100 : 0;
  const canAddLayer = timelineLayerCount < STORYBOARD_TIMELINE_LAYER_MAX;
  const canRemoveLayer = timelineLayerCount > 1;

  return (
    <div className="flex h-full min-h-0 flex-col gap-1">
      <div className="flex shrink-0 items-center justify-between gap-2 px-0.5">
        <span className="text-[10px] font-semibold text-gray-300">时间轴</span>
        <div className="flex items-center gap-1">
          {!readOnly ? (
            <>
              <button
                type="button"
                onClick={onAddLayer}
                disabled={!canAddLayer}
                title={canAddLayer ? '添加轨道层' : `最多 ${STORYBOARD_TIMELINE_LAYER_MAX} 层`}
                className={`${STORYBOARD_TOOL_BTN_GHOST} h-6 px-2 text-[9px] disabled:opacity-30`}
              >
                + 层
              </button>
              <button
                type="button"
                onClick={onRemoveLayer}
                disabled={!canRemoveLayer}
                title="移除最上层轨道"
                className={`${STORYBOARD_TOOL_BTN_GHOST} h-6 px-2 text-[9px] disabled:opacity-30`}
              >
                − 层
              </button>
            </>
          ) : null}
          <span className="text-[9px] text-gray-600">
            {readOnly ? '只读' : `${timelineLayerCount} 轨 · 拖拽排序`}
          </span>
        </div>
      </div>
      <div
        ref={scrollRef}
        className={`relative min-h-0 flex-1 cursor-pointer overflow-x-auto overflow-y-hidden rounded-xl border border-white/[0.08] bg-black/30 no-scrollbar ${STORYBOARD_ROW_SHELL}`}
        onClick={handleScrollAreaClick}
        onDragLeave={() => setDropHint(null)}
        onDrop={(e) => {
          if (readOnly || !dragging) return;
          e.preventDefault();
          const to = dropHint?.layer === dragging.layer ? dropHint.index : dragging.index;
          setDragging(null);
          setDropHint(null);
          if (to !== dragging.index) onReorderLayer(dragging.layer, dragging.index, to);
        }}
      >
        <div
          className="relative flex min-h-full min-w-full flex-col gap-0.5 py-1 pl-1 pr-2"
          style={{ minHeight: Math.max(72, timelineLayerCount * 52) }}
        >
          {layers.map((layerData) => (
            <div key={layerData.layer} className="flex min-h-[3rem] flex-1 basis-0">
              <TimelineTrack
                layer={layerData.layer}
                segments={layerData.segments}
                globalDuration={totalDuration}
                activeRowId={activeRowId}
                readOnly={readOnly}
                draggingIndex={dragging?.layer === layerData.layer ? dragging.index : null}
                dropHintIndex={dropHint?.layer === layerData.layer ? dropHint.index : null}
                axisRef={layerData.layer === 0 ? axisRef : undefined}
                onSelectRow={onSelectRow}
                onDragStart={(layer, index) => setDragging({ layer, index })}
                onDragEnd={() => {
                  setDragging(null);
                  setDropHint(null);
                }}
                onDragOver={(layer, clientX) => {
                  if (!dragging || dragging.layer !== layer) return;
                  setDropHint({ layer, index: resolveDropIndex(layer, clientX, dragging.index) });
                }}
              />
            </div>
          ))}
          {totalDuration > 0 ? (
            <div
              className="pointer-events-none absolute inset-y-1 left-8 right-2 z-10"
              aria-hidden
            >
              <div
                className="absolute inset-y-0 w-px -translate-x-1/2 bg-white/60"
                style={{ left: `${playheadPct}%` }}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
