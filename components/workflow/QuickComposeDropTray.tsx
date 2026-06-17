import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { QuickComposeDropSlot, QuickComposeDropZone } from '../../services/quickComposeMention';
import { WORKFLOW_QUICK_COMPOSE_DROP_SLOT_SHELL } from './workflowSectionUiConstants';

/** 拖出所有分区此外扩边界（px）后松手即移出队列 — 由 resolveDragHint 检测分区 DOM */
const DRAG_CLICK_SLOP = 6;

function DropThumb({ src, alt }: { src: string; alt: string }) {
  if (src && (src.startsWith('data:image/') || src.startsWith('blob:') || /^https?:\/\//i.test(src))) {
    return (
      <img
        src={src}
        alt={alt}
        className="h-9 w-9 shrink-0 rounded-lg object-cover ring-1 ring-white/[0.12]"
        draggable={false}
      />
    );
  }
  return (
    <span className="inline-grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/[0.06] text-[9px] font-bold text-gray-500 ring-1 ring-white/[0.12]">
      @
    </span>
  );
}

function elementAtPoint(clientX: number, clientY: number, ignoreEls?: (HTMLElement | null)[]): Element | null {
  if (typeof document === 'undefined') return null;
  const ignored = (ignoreEls ?? []).filter((el): el is HTMLElement => Boolean(el));
  const prev = ignored.map((el) => el.style.pointerEvents);
  for (const el of ignored) el.style.pointerEvents = 'none';
  try {
    return document.elementFromPoint(clientX, clientY);
  } finally {
    ignored.forEach((el, i) => {
      el.style.pointerEvents = prev[i] ?? '';
    });
  }
}

function quickComposeDropZoneAtPoint(
  clientX: number,
  clientY: number,
  ignoreEls?: (HTMLElement | null)[]
): QuickComposeDropZone | null {
  const el = elementAtPoint(clientX, clientY, ignoreEls);
  if (el) {
    const zoneEl = el.closest('[data-quick-compose-drop-zone]');
    if (zoneEl) {
      const z = zoneEl.getAttribute('data-quick-compose-drop-zone');
      if (z === 'main' || z === 'reference') return z;
    }
  }
  if (typeof document === 'undefined') return null;
  const nodes = document.querySelectorAll('[data-quick-compose-drop-zone]');
  for (const node of nodes) {
    const rect = node.getBoundingClientRect();
    if (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    ) {
      const z = node.getAttribute('data-quick-compose-drop-zone');
      if (z === 'main' || z === 'reference') return z;
    }
  }
  return null;
}

function slotIdAtPoint(clientX: number, clientY: number, ignoreEls?: (HTMLElement | null)[]): string | null {
  const el = elementAtPoint(clientX, clientY, ignoreEls);
  const btn = el?.closest('[data-quick-compose-slot-id]');
  const id = btn?.getAttribute('data-quick-compose-slot-id');
  return id?.trim() || null;
}

/** 目标在队列中的最终序号（0-based） */
function computeReorderTargetIndex(
  slots: QuickComposeDropSlot[],
  draggingId: string,
  clientX: number,
  clientY: number,
  trayEl: HTMLElement | null,
  ignoreEls?: (HTMLElement | null)[]
): number {
  const fromIndex = slots.findIndex((s) => s.assetId === draggingId);
  if (fromIndex < 0) return 0;

  const overId = slotIdAtPoint(clientX, clientY, ignoreEls);
  if (overId && overId !== draggingId) {
    let target = slots.findIndex((s) => s.assetId === overId);
    if (target < 0) return fromIndex;
    const overEl = trayEl?.querySelector(
      `[data-quick-compose-slot-id="${CSS.escape(overId)}"]`
    ) as HTMLElement | null;
    if (overEl) {
      const r = overEl.getBoundingClientRect();
      if (clientX > r.left + r.width / 2) target += 1;
    }
    return Math.max(0, Math.min(slots.length - 1, target));
  }

  if (trayEl) {
    const buttons = [...trayEl.querySelectorAll('[data-quick-compose-slot-id]')] as HTMLElement[];
    const siblings = buttons.filter((b) => b.getAttribute('data-quick-compose-slot-id') !== draggingId);
    if (siblings.length > 0) {
      const last = siblings[siblings.length - 1]!;
      const lr = last.getBoundingClientRect();
      if (clientX > lr.right + 4 || clientY > lr.bottom + 4) {
        return slots.length - 1;
      }
    }
  }

  return fromIndex;
}

function ghostRingCls(hint: SlotDragHint): string {
  if (hint === 'move') return 'ring-emerald-400/70';
  if (hint === 'remove') return 'ring-red-400/70';
  if (hint === 'reorder') return 'ring-sky-400/70';
  return 'ring-white/30';
}

export type QuickComposeDropTrayProps = {
  slots: QuickComposeDropSlot[];
  disabled?: boolean;
  zone?: QuickComposeDropZone;
  onRemoveSlot: (assetId: string) => void;
  /** 同区内拖动调整顺序 */
  onReorderSlot?: (assetId: string, toIndex: number) => void;
  /** 拖到另一分区时移入该分区（不删除） */
  onMoveSlotToZone?: (assetId: string) => void;
  /** 点击（非拖动）时插入 @ 引用 */
  onSlotClick?: (slot: QuickComposeDropSlot) => void;
  onStashCaret?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  /** 无缩略图时展示的空拖入占位文案 */
  emptyHint?: string;
};

type SlotDragHint = 'none' | 'reorder' | 'move' | 'remove';

type DragGhost = {
  slot: QuickComposeDropSlot;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  hint: SlotDragHint;
};

/** 队列缩略图：区内排序、跨区换区、拖出分区外移除 */
export default function QuickComposeDropTray({
  slots,
  disabled = false,
  zone,
  onRemoveSlot,
  onReorderSlot,
  onMoveSlotToZone,
  onSlotClick,
  onStashCaret,
  onDragOver,
  onDrop,
  emptyHint,
}: QuickComposeDropTrayProps) {
  const trayRef = useRef<HTMLDivElement | null>(null);
  const dragGhostRef = useRef<HTMLDivElement | null>(null);
  const dragHandleRef = useRef<HTMLElement | null>(null);
  const dragListenersRef = useRef<(() => void) | null>(null);
  const dragMovedRef = useRef(false);
  const dragSlotRef = useRef<string | null>(null);
  const dragHintRef = useRef<SlotDragHint>('none');

  const [draggingSlotId, setDraggingSlotId] = useState<string | null>(null);
  const [dragHint, setDragHint] = useState<SlotDragHint>('none');
  const [reorderHoverId, setReorderHoverId] = useState<string | null>(null);
  const [dragGhost, setDragGhost] = useState<DragGhost | null>(null);

  const dragIgnoreEls = useCallback((): (HTMLElement | null)[] => {
    return [dragHandleRef.current, dragGhostRef.current];
  }, []);

  useEffect(
    () => () => {
      dragListenersRef.current?.();
      dragListenersRef.current = null;
    },
    []
  );

  const endSlotDrag = useCallback(() => {
    dragListenersRef.current?.();
    dragListenersRef.current = null;
    dragSlotRef.current = null;
    dragHandleRef.current = null;
    dragMovedRef.current = false;
    dragHintRef.current = 'none';
    setDraggingSlotId(null);
    setDragHint('none');
    setReorderHoverId(null);
    setDragGhost(null);
  }, []);

  const resolveDragHint = useCallback(
    (clientX: number, clientY: number, moved?: boolean): SlotDragHint => {
      const atZone = quickComposeDropZoneAtPoint(clientX, clientY, dragIgnoreEls());
      if (zone && atZone === zone) {
        return moved ? 'reorder' : 'none';
      }
      if (zone && onMoveSlotToZone && atZone && atZone !== zone) {
        return 'move';
      }
      if (atZone) return 'none';
      return 'remove';
    },
    [dragIgnoreEls, onMoveSlotToZone, zone]
  );

  const startSlotDrag = useCallback(
    (assetId: string, e: React.PointerEvent<HTMLButtonElement>) => {
      if (disabled) return;
      e.preventDefault();
      e.stopPropagation();
      onStashCaret?.();

      const handle = e.currentTarget;
      dragHandleRef.current = handle;
      handle.setPointerCapture(e.pointerId);
      dragSlotRef.current = assetId;
      dragMovedRef.current = false;
      dragHintRef.current = 'none';
      setDraggingSlotId(assetId);
      setDragHint('none');
      setReorderHoverId(null);
      setDragGhost(null);

      const slot = slots.find((s) => s.assetId === assetId);
      if (!slot) return;

      const rect = handle.getBoundingClientRect();
      const offsetX = e.clientX - rect.left;
      const offsetY = e.clientY - rect.top;
      const originX = e.clientX;
      const originY = e.clientY;

      const onMove = (ev: PointerEvent) => {
        ev.preventDefault();
        const dx = ev.clientX - originX;
        const dy = ev.clientY - originY;
        if (Math.hypot(dx, dy) >= DRAG_CLICK_SLOP) dragMovedRef.current = true;
        const moved = dragMovedRef.current;
        const hint = resolveDragHint(ev.clientX, ev.clientY, moved);
        dragHintRef.current = hint;
        setDragHint(hint);
        if (moved) {
          setDragGhost({
            slot,
            x: ev.clientX,
            y: ev.clientY,
            offsetX,
            offsetY,
            hint,
          });
        } else {
          setDragGhost(null);
        }
        if (hint === 'reorder') {
          const over = slotIdAtPoint(ev.clientX, ev.clientY, dragIgnoreEls());
          setReorderHoverId(over && over !== assetId ? over : null);
        } else {
          setReorderHoverId(null);
        }
      };

      const onEnd = (ev: PointerEvent) => {
        try {
          if (handle.hasPointerCapture(ev.pointerId)) handle.releasePointerCapture(ev.pointerId);
        } catch {
          /* ignore */
        }
        const id = dragSlotRef.current;
        const moved = dragMovedRef.current;
        const hint = resolveDragHint(ev.clientX, ev.clientY, moved);
        endSlotDrag();
        if (!id) return;
        if (!moved) {
          if (onSlotClick) {
            const s = slots.find((x) => x.assetId === id);
            if (s) onSlotClick(s);
          }
          return;
        }

        if (hint === 'move' && onMoveSlotToZone) {
          onMoveSlotToZone(id);
          return;
        }
        if (hint === 'remove') {
          onRemoveSlot(id);
          return;
        }
        if (hint === 'reorder' && onReorderSlot) {
          const targetIndex = computeReorderTargetIndex(
            slots,
            id,
            ev.clientX,
            ev.clientY,
            trayRef.current,
            dragIgnoreEls()
          );
          onReorderSlot(id, targetIndex);
        }
      };

      const cleanup = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onEnd);
        window.removeEventListener('pointercancel', onEnd);
        dragListenersRef.current = null;
      };

      dragListenersRef.current?.();
      dragListenersRef.current = cleanup;
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onEnd);
      window.addEventListener('pointercancel', onEnd);
    },
    [
      disabled,
      dragIgnoreEls,
      endSlotDrag,
      onMoveSlotToZone,
      onRemoveSlot,
      onReorderSlot,
      onSlotClick,
      onStashCaret,
      resolveDragHint,
      slots,
    ]
  );

  const slotHelpText = onSlotClick
    ? onReorderSlot
      ? '点击插入 @，拖动调整顺序，拖到另一区换区，拖出分区外移出队列'
      : '点击插入 @，拖出分区外移出队列'
    : onReorderSlot
      ? '拖动调整顺序，拖到另一区换区，拖出分区外移出队列'
      : onMoveSlotToZone
        ? '拖到另一区可换区，拖出分区外移出队列'
        : '按此顺序送模；拖出分区外移出队列';

  const ghostPortal =
    dragGhost && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={dragGhostRef}
            data-quick-compose-drag-ghost=""
            className={`pointer-events-none fixed z-[2700] inline-flex items-center gap-0.5 py-0.5 pl-0.5 pr-1 ring-2 ${WORKFLOW_QUICK_COMPOSE_DROP_SLOT_SHELL} ${ghostRingCls(dragGhost.hint)}`}
            style={{
              left: dragGhost.x - dragGhost.offsetX,
              top: dragGhost.y - dragGhost.offsetY,
            }}
          >
            <DropThumb src={dragGhost.slot.previewSrc} alt={dragGhost.slot.label} />
            <span className="pr-0.5 text-[10px] font-bold tabular-nums leading-none text-gray-100">
              {dragGhost.slot.label}
            </span>
          </div>,
          document.body
        )
      : null;

  if (slots.length === 0) {
    return (
      <>
        {ghostPortal}
        {emptyHint ? (
          <div
            className="flex min-h-9 w-fit max-w-full items-center justify-center self-center rounded-lg border border-dashed border-white/20 bg-transparent px-2 py-1.5 text-[9px] text-gray-500"
            onDragOver={onDragOver}
            onDrop={onDrop}
          >
            {emptyHint}
          </div>
        ) : null}
      </>
    );
  }

  return (
    <>
      <div
        ref={trayRef}
        className={`flex w-fit max-w-full flex-wrap items-center justify-center gap-1.5 ${draggingSlotId ? 'select-none' : ''}`}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        {slots.map((s) => {
          const isDragging = draggingSlotId === s.assetId;
          const isHoverTarget = reorderHoverId === s.assetId;
          return (
            <button
              key={s.assetId}
              type="button"
              data-quick-compose-slot-id={s.assetId}
              disabled={disabled}
              onPointerDown={(ev) => startSlotDrag(s.assetId, ev)}
              className={`touch-none inline-flex items-center gap-0.5 py-0.5 pl-0.5 pr-1 transition ${WORKFLOW_QUICK_COMPOSE_DROP_SLOT_SHELL} ${
                isDragging
                  ? 'invisible pointer-events-none'
                  : isHoverTarget
                    ? 'cursor-grab ring-2 ring-sky-400/45'
                    : 'cursor-grab hover:border-white/[0.14] hover:ring-white/[0.1]'
              } disabled:opacity-40`}
              title={`${s.label}，${slotHelpText}`}
              aria-label={`${s.label}，点击插入 @ 或拖动排序`}
            >
              <DropThumb src={s.previewSrc} alt={s.label} />
              <span className="pr-0.5 text-[10px] font-bold tabular-nums leading-none text-gray-200">
                {s.label}
              </span>
            </button>
          );
        })}
      </div>
      {ghostPortal}
    </>
  );
}
