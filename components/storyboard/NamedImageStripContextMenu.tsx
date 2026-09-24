import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { computeContextMenuPosition } from '../../services/floatingMenuPosition';

export type NamedImageStripContextMenuProps = {
  open: boolean;
  x: number;
  y: number;
  canDelete?: boolean;
  onDownload: () => void;
  onDelete?: () => void;
  onClose: () => void;
};

const itemCls =
  'block w-full rounded-md px-2.5 py-1.5 text-left text-[11px] text-gray-200 transition-colors hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-35';

/** 参考图条 / 角色条缩略图右键：下载、删除 */
export default function NamedImageStripContextMenu({
  open,
  x,
  y,
  canDelete = true,
  onDownload,
  onDelete,
  onClose,
}: NamedImageStripContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    if (!open) {
      setPosition({ left: x, top: y });
      return;
    }
    const el = menuRef.current;
    if (!el) {
      setPosition({ left: x, top: y });
      return;
    }
    const rect = el.getBoundingClientRect();
    setPosition(
      computeContextMenuPosition(x, y, rect.width, rect.height, window.innerWidth, window.innerHeight)
    );
  }, [open, x, y, canDelete, onDelete]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-named-image-strip-context-menu="1"]')) return;
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
      ref={menuRef}
      role="menu"
      data-named-image-strip-context-menu="1"
      data-ac-allow-context-menu
      className="fixed z-[2600] min-w-[7.5rem] max-w-[12rem] overflow-hidden rounded-xl border border-white/[0.08] bg-[#0f0f12] p-1 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.75)] ring-1 ring-white/[0.05]"
      style={{ left: position.left, top: position.top }}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        role="menuitem"
        className={itemCls}
        onClick={() => {
          onDownload();
          onClose();
        }}
      >
        下载
      </button>
      {onDelete ? (
        <button
          type="button"
          role="menuitem"
          disabled={!canDelete}
          className={`${itemCls} text-red-300`}
          onClick={() => {
            if (!canDelete) return;
            onDelete();
            onClose();
          }}
        >
          删除
        </button>
      ) : null}
    </div>,
    document.body
  );
}
