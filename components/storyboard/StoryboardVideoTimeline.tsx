import React, { useCallback, useRef, useState } from 'react';
import type { StoryboardVideoSegment } from '../../services/storyboardVideoTimeline';
import { storyboardTimelineDropIndex } from '../../services/storyboardVideoTimeline';
import {
  STORYBOARD_GAP_TIGHT,
  STORYBOARD_ROW_SHELL,
} from './storyboardTableUi';

const DRAG_MIME = 'application/x-ac-storyboard-row';

type Props = {
  segments: StoryboardVideoSegment[];
  activeRowId: string | null;
  playheadTime: number;
  totalDuration: number;
  readOnly?: boolean;
  onSelectRow: (rowId: string) => void;
  onSeek: (timeSec: number) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
};

export default function StoryboardVideoTimeline({
  segments,
  activeRowId,
  playheadTime,
  totalDuration,
  readOnly = false,
  onSelectRow,
  onSeek,
  onReorder,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dropHintIndex, setDropHintIndex] = useState<number | null>(null);

  const handleTrackClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = trackRef.current;
      if (!el || totalDuration <= 0) return;
      if ((e.target as HTMLElement).closest('[data-timeline-clip]')) return;
      const rect = el.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      onSeek(ratio * totalDuration);
    },
    [onSeek, totalDuration]
  );

  const resolveDropIndex = useCallback(
    (clientX: number, fromIndex: number) => {
      const el = trackRef.current;
      if (!el) return fromIndex;
      return storyboardTimelineDropIndex(
        clientX,
        el.getBoundingClientRect(),
        segments.length,
        segments.map((s) => s.durationSec),
        fromIndex
      );
    },
    [segments]
  );

  const playheadPct = totalDuration > 0 ? (playheadTime / totalDuration) * 100 : 0;

  return (
    <div className="flex h-full min-h-0 flex-col gap-1">
      <div className="flex shrink-0 items-center justify-between px-0.5">
        <span className="text-[10px] font-semibold text-gray-300">时间轴</span>
        <span className="text-[9px] text-gray-600">
          {readOnly ? '只读' : '拖拽排序 · 点击定位'}
        </span>
      </div>
      <div
        ref={trackRef}
        className={`relative flex h-full min-h-0 cursor-pointer items-stretch overflow-x-auto overflow-y-hidden rounded-xl border border-white/[0.08] bg-black/30 no-scrollbar ${STORYBOARD_ROW_SHELL}`}
        onClick={handleTrackClick}
        onDragOver={(e) => {
          if (readOnly || draggingIndex == null) return;
          e.preventDefault();
          setDropHintIndex(resolveDropIndex(e.clientX, draggingIndex));
        }}
        onDragLeave={() => setDropHintIndex(null)}
        onDrop={(e) => {
          if (readOnly || draggingIndex == null) return;
          e.preventDefault();
          const to = resolveDropIndex(e.clientX, draggingIndex);
          setDraggingIndex(null);
          setDropHintIndex(null);
          if (to !== draggingIndex) onReorder(draggingIndex, to);
        }}
      >
        {segments.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-[10px] text-gray-600">
            暂无镜头
          </div>
        ) : (
          segments.map((seg, i) => {
            const flexGrow = Math.max(0.35, seg.durationSec);
            const active = activeRowId === seg.rowId;
            const isDragging = draggingIndex === i;
            const showDropBefore = dropHintIndex === i && draggingIndex != null && draggingIndex !== i;
            return (
              <React.Fragment key={seg.rowId}>
                {showDropBefore ? (
                  <div className="w-1 shrink-0 bg-violet-400/90 shadow-[0_0_8px_rgba(167,139,250,0.8)]" />
                ) : null}
                <div
                  data-timeline-clip
                  draggable={!readOnly}
                  onDragStart={(e) => {
                    if (readOnly) return;
                    setDraggingIndex(i);
                    e.dataTransfer.setData(DRAG_MIME, seg.rowId);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragEnd={() => {
                    setDraggingIndex(null);
                    setDropHintIndex(null);
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectRow(seg.rowId);
                  }}
                  style={{ flexGrow }}
                  className={`group relative flex min-w-[3.5rem] flex-col border-r border-white/[0.06] transition-opacity last:border-r-0 ${
                    isDragging ? 'opacity-40' : 'opacity-100'
                  } ${active ? 'bg-violet-500/10 ring-1 ring-inset ring-violet-400/35' : 'hover:bg-white/[0.03]'}`}
                  title={`${seg.shotNo} · ${seg.durationSec.toFixed(1)}s`}
                >
                  <div className="relative min-h-0 flex-1 overflow-hidden bg-black/40">
                    {seg.frameImage ? (
                      <img
                        src={seg.frameImage}
                        alt=""
                        className="h-full w-full object-contain object-center"
                        draggable={false}
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-[9px] font-bold text-gray-600">
                        {seg.shotNo}
                      </div>
                    )}
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-1 pb-0.5 pt-2">
                      <span className="text-[8px] font-bold text-white/95">{seg.shotNo}</span>
                    </div>
                  </div>
                  <div
                    className={`flex h-4 shrink-0 items-center justify-between ${STORYBOARD_GAP_TIGHT} px-1`}
                  >
                    <span className="text-[7px] text-gray-500">
                      {seg.durationSec.toFixed(1)}s{seg.durationIsEstimated ? '*' : ''}
                    </span>
                    {!readOnly ? (
                      <span className="text-[7px] text-gray-600 opacity-0 group-hover:opacity-100">
                        拖
                      </span>
                    ) : null}
                  </div>
                </div>
              </React.Fragment>
            );
          })
        )}
        {totalDuration > 0 ? (
          <div
            className="pointer-events-none absolute inset-y-1 z-10 w-px -translate-x-1/2 bg-violet-300/80"
            style={{ left: `${playheadPct}%` }}
          />
        ) : null}
      </div>
    </div>
  );
}
