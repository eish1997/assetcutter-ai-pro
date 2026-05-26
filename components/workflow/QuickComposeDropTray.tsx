import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { QuickComposeDropSlot } from '../../services/quickComposeMention';

/** 拖出托盘外扩边界（px）后松手即移除 */
const TRAY_REMOVE_PAD = 28;
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

function isOutsideTrayBounds(
  trayEl: HTMLElement | null,
  clientX: number,
  clientY: number,
  pad: number
): boolean {
  if (!trayEl) return true;
  const r = trayEl.getBoundingClientRect();
  return (
    clientX < r.left - pad ||
    clientX > r.right + pad ||
    clientY < r.top - pad ||
    clientY > r.bottom + pad
  );
}

export type QuickComposeDropTrayProps = {
  slots: QuickComposeDropSlot[];
  disabled?: boolean;
  atMentionLimit?: boolean;
  onActivate: (assetId: string) => void;
  onRemoveSlot: (assetId: string) => void;
  onStashCaret?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
};

/** 待 @ 参考图：展示在输入框上方；点击插入光标，拖出托盘范围松手移除 */
export default function QuickComposeDropTray({
  slots,
  disabled = false,
  atMentionLimit = false,
  onActivate,
  onRemoveSlot,
  onStashCaret,
  onDragOver,
  onDrop,
}: QuickComposeDropTrayProps) {
  const trayRef = useRef<HTMLDivElement | null>(null);
  const dragListenersRef = useRef<(() => void) | null>(null);
  const dragMovedRef = useRef(false);
  const dragSlotRef = useRef<string | null>(null);
  const wasOutsideRef = useRef(false);

  const [draggingSlotId, setDraggingSlotId] = useState<string | null>(null);
  const [removeHint, setRemoveHint] = useState(false);

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
    dragMovedRef.current = false;
    setDraggingSlotId(null);
    setRemoveHint(false);
  }, []);

  const startSlotDrag = useCallback(
    (assetId: string, e: React.PointerEvent<HTMLButtonElement>) => {
      if (disabled) return;
      e.preventDefault();
      e.stopPropagation();
      onStashCaret?.();

      const handle = e.currentTarget;
      handle.setPointerCapture(e.pointerId);
      dragSlotRef.current = assetId;
      dragMovedRef.current = false;
      wasOutsideRef.current = false;
      setDraggingSlotId(assetId);

      const originX = e.clientX;
      const originY = e.clientY;

      const onMove = (ev: PointerEvent) => {
        ev.preventDefault();
        const dx = ev.clientX - originX;
        const dy = ev.clientY - originY;
        if (Math.hypot(dx, dy) >= DRAG_CLICK_SLOP) dragMovedRef.current = true;
        if (isOutsideTrayBounds(trayRef.current, ev.clientX, ev.clientY, TRAY_REMOVE_PAD)) {
          wasOutsideRef.current = true;
        }
        setRemoveHint(wasOutsideRef.current);
      };

      const onEnd = (ev: PointerEvent) => {
        try {
          if (handle.hasPointerCapture(ev.pointerId)) handle.releasePointerCapture(ev.pointerId);
        } catch {
          /* ignore */
        }
        const id = dragSlotRef.current;
        const moved = dragMovedRef.current;
        const outside =
          wasOutsideRef.current ||
          isOutsideTrayBounds(trayRef.current, ev.clientX, ev.clientY, TRAY_REMOVE_PAD);
        endSlotDrag();
        if (!id) return;
        if (outside) {
          onRemoveSlot(id);
          return;
        }
        if (!moved && !atMentionLimit) onActivate(id);
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
    [atMentionLimit, disabled, endSlotDrag, onActivate, onRemoveSlot, onStashCaret]
  );

  if (slots.length === 0) return null;

  return (
    <div
      ref={trayRef}
      className={`flex flex-wrap items-center gap-1.5 ${draggingSlotId ? 'select-none' : ''}`}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {slots.map((s) => {
        const isDragging = draggingSlotId === s.assetId;
        return (
          <button
            key={s.assetId}
            type="button"
            disabled={disabled || (atMentionLimit && !isDragging)}
            onPointerDown={(ev) => startSlotDrag(s.assetId, ev)}
            className={`touch-none rounded-md p-0.5 ring-1 ring-dashed transition ${
              isDragging
                ? `cursor-grabbing ${removeHint ? 'opacity-35 ring-red-400/50' : 'opacity-50 ring-sky-400/40'}`
                : 'cursor-grab ring-white/25 hover:ring-sky-400/50'
            } disabled:opacity-40`}
            title="点击插入光标；拖出虚线框松手可移除"
            aria-label={`${s.label}，点击插入，拖出移除`}
          >
            <DropThumb src={s.previewSrc} alt={s.label} />
          </button>
        );
      })}
    </div>
  );
}
