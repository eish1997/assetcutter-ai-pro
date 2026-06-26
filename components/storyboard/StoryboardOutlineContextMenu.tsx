import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

type Props = {
  open: boolean;
  x: number;
  y: number;
  onInsertBefore: () => void;
  onInsertAfter: () => void;
  onClose: () => void;
};

export default function StoryboardOutlineContextMenu({
  open,
  x,
  y,
  onInsertBefore,
  onInsertAfter,
  onClose,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-storyboard-outline-menu="1"]')) return;
      onClose();
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [onClose, open]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      data-storyboard-outline-menu="1"
      className="fixed z-[2300] min-w-[10.5rem] max-w-[15rem] overflow-hidden rounded-xl border border-white/[0.08] bg-[#0f0f0f] py-1 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.75)]"
      style={{ left: x, top: y }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button
        type="button"
        className="block w-full px-2.5 py-1.5 text-left text-[11px] text-gray-200 transition-colors hover:bg-white/[0.06]"
        onClick={() => {
          onInsertBefore();
          onClose();
        }}
      >
        添加镜头·前
      </button>
      <button
        type="button"
        className="block w-full px-2.5 py-1.5 text-left text-[11px] text-gray-200 transition-colors hover:bg-white/[0.06]"
        onClick={() => {
          onInsertAfter();
          onClose();
        }}
      >
        添加镜头·后
      </button>
    </div>,
    document.body
  );
}
