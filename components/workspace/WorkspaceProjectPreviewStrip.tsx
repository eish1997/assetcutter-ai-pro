import React, { useCallback, useEffect, useRef, useState } from 'react';
import { WorkflowGridImage } from '../ProgressivePreviewImage';
import AppIcon from '../ui/AppIcon';
import { WORKFLOW_CARD_INNER_RADIUS, WORKFLOW_CARD_SURFACE_IDLE } from '../workflow/workflowSectionUiConstants';
import type { WorkspaceProjectPreviewItem } from '../../services/workspaceProjectPreviews';

const DRAG_CLICK_THRESHOLD_PX = 6;
const PREVIEW_CARD_CLASS = `relative shrink-0 w-[5.75rem] aspect-[4/3] overflow-hidden bg-[#16161a] ${WORKFLOW_CARD_INNER_RADIUS} ${WORKFLOW_CARD_SURFACE_IDLE}`;

type Props = {
  items: WorkspaceProjectPreviewItem[];
  totalEligible: number;
  loading?: boolean;
  disabled?: boolean;
  onOpen: () => void;
};

export default function WorkspaceProjectPreviewStrip({
  items,
  totalEligible,
  loading = false,
  disabled = false,
  onOpen,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; scrollLeft: number; moved: boolean } | null>(null);
  const [fadeLeft, setFadeLeft] = useState(false);
  const [fadeRight, setFadeRight] = useState(false);
  const [overflowing, setOverflowing] = useState(false);

  const updateFade = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    const canScroll = scrollWidth > clientWidth + 2;
    setOverflowing(canScroll);
    setFadeLeft(canScroll && scrollLeft > 4);
    setFadeRight(canScroll && scrollLeft + clientWidth < scrollWidth - 4);
  }, []);

  useEffect(() => {
    updateFade();
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => updateFade());
    ro.observe(el);
    return () => ro.disconnect();
  }, [items, loading, updateFade]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || loading || event.button !== 0) return;
    const el = scrollRef.current;
    if (!el) return;
    dragRef.current = { startX: event.clientX, scrollLeft: el.scrollLeft, moved: false };
    el.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const el = scrollRef.current;
    if (!drag || !el) return;
    const dx = event.clientX - drag.startX;
    if (Math.abs(dx) > DRAG_CLICK_THRESHOLD_PX) drag.moved = true;
    el.scrollLeft = drag.scrollLeft - dx;
    updateFade();
  };

  const finishPointer = (event: React.PointerEvent<HTMLDivElement>, shouldOpen: boolean) => {
    const drag = dragRef.current;
    const el = scrollRef.current;
    if (el?.hasPointerCapture(event.pointerId)) {
      el.releasePointerCapture(event.pointerId);
    }
    const moved = drag?.moved ?? false;
    dragRef.current = null;
    if (shouldOpen && !moved && !disabled && !loading) onOpen();
  };

  const extraCount = Math.max(0, totalEligible - items.length);
  const showPlaceholder = !loading && items.length === 0;

  return (
    <div className="relative min-w-0 flex-1">
      <div
        ref={scrollRef}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label="项目预览画廊，拖拽左右浏览，点击进入项目"
        className={`flex min-h-[4.75rem] items-center gap-2 overflow-x-auto px-1 py-1 no-scrollbar outline-none ${
          disabled ? 'pointer-events-none opacity-50' : 'cursor-grab active:cursor-grabbing'
        }`}
        onScroll={updateFade}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => finishPointer(e, true)}
        onPointerCancel={(e) => finishPointer(e, false)}
        onKeyDown={(e) => {
          if (disabled || loading) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen();
          }
        }}
      >
        {loading
          ? Array.from({ length: 4 }, (_, i) => (
              <div
                key={`sk-${i}`}
                className={`${PREVIEW_CARD_CLASS} animate-pulse bg-white/[0.04] ring-0`}
              />
            ))
          : null}

        {!loading && showPlaceholder ? (
          <div className={`${PREVIEW_CARD_CLASS} flex items-center justify-center`}>
            <AppIcon name="package" className="h-5 w-5 text-white/25" />
          </div>
        ) : null}

        {!loading
          ? items.map((item, index) => {
              const isLast = index === items.length - 1;
              const showMoreBadge = isLast && extraCount > 0;
              return (
                <div
                  key={item.assetId}
                  className={`group/preview ${PREVIEW_CARD_CLASS} transition-transform duration-200 ease-out hover:scale-[1.04] hover:z-10`}
                >
                  <WorkflowGridImage
                    fullSrc={item.src}
                    cacheKey={`ws-proj-prev:${item.assetId}`}
                    thumbMaxEdge={320}
                    imageFetchPriority="low"
                    className="relative h-full w-full"
                    imgClassName="block h-full w-full object-cover"
                    draggable={false}
                    onDragStart={(e) => e.preventDefault()}
                  />
                  {showMoreBadge ? (
                    <span className="pointer-events-none absolute bottom-1 right-1 rounded-md bg-black/65 px-1.5 py-0.5 text-[8px] font-bold tabular-nums text-white/90 ring-1 ring-white/10">
                      +{extraCount}
                    </span>
                  ) : null}
                </div>
              );
            })
          : null}
      </div>

      {overflowing && fadeLeft ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 z-10 w-12 bg-gradient-to-r from-[#141416] via-[#141416]/90 to-transparent transition-opacity duration-200"
        />
      ) : null}
      {overflowing && fadeRight ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 z-10 w-12 bg-gradient-to-l from-[#141416] via-[#141416]/90 to-transparent transition-opacity duration-200"
        />
      ) : null}
    </div>
  );
}
