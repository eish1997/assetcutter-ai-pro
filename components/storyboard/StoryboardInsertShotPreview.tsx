import React, { useCallback, useMemo, useRef, useState } from 'react';
import type { StoryboardTableRow } from '../../types';
import type { InsertShotPreviewStrip, InsertShotPreviewTile } from '../../services/storyboardInsertShot';
import { buildInsertShotPreviewStrip, formatInsertShotPreviewRange, wrapInsertShotPickerNumeric } from '../../services/storyboardInsertShot';

type Props = {
  rows: StoryboardTableRow[];
  insertCount?: number;
  preview: InsertShotPreviewStrip | null;
  insertNumeric: number | null;
  pickerMin: number;
  pickerMax: number;
  onInsertNumericChange?: (numeric: number) => void;
  disabled?: boolean;
};

const DRAG_STEP_PX = 56;

function tileStableKey(tile: InsertShotPreviewTile, index: number, side: 'left' | 'right'): string {
  if (tile.kind === 'wrapGap') return `${side}-gap-${index}`;
  if (tile.kind === 'more') return `${side}-more-${tile.label}`;
  if (tile.kind === 'unchanged') return `${side}-u-${tile.shotNo}-${index}`;
  if (tile.kind === 'new') return `${side}-new-${tile.shotNo}`;
  return `${side}-s-${tile.fromShotNo}-${tile.toShotNo}-${index}`;
}

function WrapGapTile() {
  return (
    <div
      className="flex h-[3.25rem] w-[2.75rem] shrink-0 flex-col items-center justify-center rounded-lg border border-dashed border-white/15 bg-white/[0.02]"
      title="首尾分界：区分「插在首镜前」与「插在末镜后」"
    >
      <span className="text-[8px] leading-none text-gray-500">留空</span>
    </div>
  );
}

function ContextTile({ tile }: { tile: InsertShotPreviewTile }) {
  if (tile.kind === 'wrapGap') return <WrapGapTile />;

  if (tile.kind === 'unchanged') {
    return (
      <div className="flex h-[3.25rem] min-w-[3rem] shrink-0 items-center justify-center rounded-lg bg-white/[0.04] px-2 ring-1 ring-white/[0.06]">
        <span className="text-[11px] font-semibold tabular-nums text-gray-400">{tile.shotNo}</span>
      </div>
    );
  }

  if (tile.kind === 'shifted') {
    return (
      <div
        className="flex h-[3.25rem] min-w-[3rem] shrink-0 items-center justify-center rounded-lg bg-white/[0.04] px-2 ring-1 ring-white/[0.06]"
        title={`插入后镜号 ${tile.toShotNo}`}
      >
        <span className="text-[11px] font-semibold tabular-nums text-gray-400">{tile.toShotNo}</span>
      </div>
    );
  }

  return null;
}

function InsertSlot({ shotLabel, dragging }: { shotLabel: string; dragging?: boolean }) {
  const isRange = shotLabel.includes('–');
  return (
    <div
      className={`flex h-[3.75rem] shrink-0 flex-col items-center justify-center rounded-xl border-2 border-dashed px-2 ${
        isRange ? 'min-w-[4.5rem]' : 'w-[4rem]'
      } ${
        dragging
          ? 'border-emerald-300/75 bg-emerald-400/15 shadow-[0_0_20px_rgba(52,211,153,0.2)]'
          : 'border-emerald-400/50 bg-emerald-400/10'
      }`}
    >
      <span className="text-[8px] leading-none text-emerald-200/80">插入</span>
      <span
        className={`mt-1.5 font-bold tabular-nums leading-none text-emerald-50 ${
          isRange ? 'text-[10px] tracking-tight' : 'text-[13px]'
        }`}
      >
        {shotLabel}
      </span>
    </div>
  );
}

function FadeColumn({
  children,
  edge,
  slideStyle,
}: {
  children: React.ReactNode;
  edge: 'left' | 'right';
  slideStyle?: React.CSSProperties;
}) {
  return (
    <div className="relative min-w-0">
      <div className="overflow-hidden">
        <div
          className={`flex items-center gap-1.5 will-change-transform ${
            edge === 'left' ? 'justify-end' : 'justify-start'
          }`}
          style={slideStyle}
        >
          {children}
        </div>
      </div>
      <div
        className={`pointer-events-none absolute inset-y-0 z-10 w-10 ${
          edge === 'left'
            ? 'left-0 bg-gradient-to-r from-[#14141a] via-[#14141a]/80 to-transparent'
            : 'right-0 bg-gradient-to-l from-[#14141a] via-[#14141a]/80 to-transparent'
        }`}
        aria-hidden
      />
    </div>
  );
}

function numericFromDragDelta(startNumeric: number, deltaX: number, pickerMin: number, pickerMax: number): number {
  const steps = -Math.round(deltaX / DRAG_STEP_PX);
  return wrapInsertShotPickerNumeric(startNumeric + steps, pickerMin, pickerMax);
}

export default function StoryboardInsertShotPreview({
  rows,
  insertCount = 1,
  preview,
  insertNumeric,
  pickerMin,
  pickerMax,
  onInsertNumericChange,
  disabled = false,
}: Props) {
  const dragRef = useRef<{ pointerId: number; startX: number; startNumeric: number } | null>(null);
  const [dragOffsetPx, setDragOffsetPx] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const canDrag =
    !disabled &&
    Boolean(onInsertNumericChange) &&
    insertNumeric != null &&
    pickerMax >= pickerMin;

  const dragTargetNumeric = useMemo(() => {
    if (!isDragging || !dragRef.current) return null;
    return numericFromDragDelta(
      dragRef.current.startNumeric,
      dragOffsetPx,
      pickerMin,
      pickerMax
    );
  }, [dragOffsetPx, isDragging, pickerMax, pickerMin]);

  const effectiveNumeric = dragTargetNumeric ?? insertNumeric;
  const slotShotLabel = useMemo(() => {
    if (effectiveNumeric != null) {
      return formatInsertShotPreviewRange(effectiveNumeric, insertCount);
    }
    if (preview?.insertShotNo && preview.insertShotNoEnd) {
      return preview.insertShotNo === preview.insertShotNoEnd
        ? preview.insertShotNo
        : `${preview.insertShotNo}–${preview.insertShotNoEnd}`;
    }
    return preview?.insertShotNo ?? '---';
  }, [effectiveNumeric, insertCount, preview?.insertShotNo, preview?.insertShotNoEnd]);

  const displayPreview = useMemo(() => {
    if (effectiveNumeric == null) return preview;
    if (isDragging && dragTargetNumeric != null) {
      return buildInsertShotPreviewStrip(rows, dragTargetNumeric, insertCount);
    }
    return preview;
  }, [dragTargetNumeric, effectiveNumeric, insertCount, isDragging, preview, rows]);

  const leftTiles = displayPreview?.leftTiles ?? [];
  const rightTiles = displayPreview?.rightTiles ?? [];
  const slideStyle = { transform: `translate3d(${dragOffsetPx}px,0,0)` };

  const clampNumeric = useCallback(
    (value: number) => wrapInsertShotPickerNumeric(value, pickerMin, pickerMax),
    [pickerMax, pickerMin]
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!canDrag || event.button !== 0 || !preview) return;
      event.preventDefault();
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startNumeric: insertNumeric!,
      };
      setIsDragging(true);
      setDragOffsetPx(0);
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [canDrag, insertNumeric, preview]
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.preventDefault();
      setDragOffsetPx(event.clientX - drag.startX);
    },
    []
  );

  const endDrag = useCallback(
    (deltaX: number) => {
      const drag = dragRef.current;
      if (drag && onInsertNumericChange) {
        const finalNumeric = numericFromDragDelta(drag.startNumeric, deltaX, pickerMin, pickerMax);
        if (finalNumeric !== insertNumeric) {
          onInsertNumericChange(finalNumeric);
        }
      }
      dragRef.current = null;
      setDragOffsetPx(0);
      setIsDragging(false);
    },
    [insertNumeric, onInsertNumericChange, pickerMax, pickerMin]
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      endDrag(event.clientX - drag.startX);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [endDrag]
  );

  const onPointerCancel = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      endDrag(event.clientX - drag.startX);
    },
    [endDrag]
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!canDrag || !onInsertNumericChange || insertNumeric == null) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        onInsertNumericChange(clampNumeric(insertNumeric + 1));
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        onInsertNumericChange(clampNumeric(insertNumeric - 1));
      }
    },
    [canDrag, clampNumeric, insertNumeric, onInsertNumericChange]
  );

  if (!preview || (!leftTiles.length && !rightTiles.length && !preview.insertShotNo)) {
    return (
      <div className="flex h-20 items-center justify-center rounded-xl bg-black/25 ring-1 ring-white/[0.06] text-[10px] text-gray-600">
        输入镜号后预览插入位置
      </div>
    );
  }

  const ariaValue = effectiveNumeric ?? pickerMin;

  return (
    <div className="space-y-1">
      <div className="overflow-hidden rounded-xl bg-[#14141a]/90 ring-1 ring-white/[0.06]">
        <div
          role="slider"
          tabIndex={canDrag ? 0 : -1}
          aria-valuemin={pickerMin}
          aria-valuemax={pickerMax}
          aria-valuenow={ariaValue}
          aria-label="拖拽微调起始镜号"
          title={canDrag ? '左右拖拽微调起始镜号，头尾循环' : undefined}
          className={`grid min-h-[5.25rem] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-1 py-3 outline-none ${
            canDrag ? 'cursor-grab touch-none select-none active:cursor-grabbing' : ''
          }`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onKeyDown={onKeyDown}
        >
          <FadeColumn edge="left" slideStyle={slideStyle}>
            {leftTiles.map((tile, index) => (
              <ContextTile key={tileStableKey(tile, index, 'left')} tile={tile} />
            ))}
          </FadeColumn>

          <InsertSlot shotLabel={slotShotLabel} dragging={isDragging} />

          <FadeColumn edge="right" slideStyle={slideStyle}>
            {rightTiles.map((tile, index) => (
              <ContextTile key={tileStableKey(tile, index, 'right')} tile={tile} />
            ))}
          </FadeColumn>
        </div>
      </div>
    </div>
  );
}
