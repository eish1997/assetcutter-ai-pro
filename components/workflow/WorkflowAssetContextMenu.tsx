import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { computeContextMenuPosition } from '../../services/floatingMenuPosition';

export type WorkflowAssetContextMenuProps = {
  open: boolean;
  x: number;
  y: number;
  canCopyImage: boolean;
  onCopyImage: () => void;
  onCopyId: () => void;
  canOpenFolder?: boolean;
  onOpenFolder?: () => void;
  canAddToComposeInput?: boolean;
  onAddToComposeInput?: () => void;
  onClose: () => void;
};

/**
 * 工作区资产图：右键「复制 / 复制 ID / 添加到输入框」。
 */
export default function WorkflowAssetContextMenu({
  open,
  x,
  y,
  canCopyImage,
  onCopyImage,
  onCopyId,
  canOpenFolder = false,
  onOpenFolder,
  canAddToComposeInput = false,
  onAddToComposeInput,
  onClose,
}: WorkflowAssetContextMenuProps) {
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
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    setPosition(
      computeContextMenuPosition(x, y, rect.width, rect.height, vw, vh)
    );
  }, [open, x, y, canAddToComposeInput, canCopyImage, canOpenFolder]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => {
      const el = menuRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setPosition(
        computeContextMenuPosition(
          x,
          y,
          rect.width,
          rect.height,
          window.innerWidth,
          window.innerHeight
        )
      );
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open, x, y]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-workflow-asset-context-menu="1"]')) return;
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
      data-workflow-asset-context-menu="1"
      data-ac-allow-context-menu
      className="fixed z-[2600] min-w-[9.5rem] max-w-[14rem] overflow-hidden rounded-xl border border-white/[0.08] bg-[#0f0f0f] py-1 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.75)]"
      style={{ left: position.left, top: position.top }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button
        type="button"
        disabled={!canCopyImage}
        className="block w-full px-2.5 py-1.5 text-left text-[11px] text-gray-200 transition-colors hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-35"
        onClick={() => {
          if (!canCopyImage) return;
          onCopyImage();
          onClose();
        }}
      >
        复制
      </button>
      <button
        type="button"
        className="block w-full px-2.5 py-1.5 text-left text-[11px] text-gray-200 transition-colors hover:bg-white/[0.06]"
        onClick={() => {
          onCopyId();
          onClose();
        }}
      >
        复制 ID
      </button>
      {onOpenFolder ? (
        <button
          type="button"
          disabled={!canOpenFolder}
          className="block w-full px-2.5 py-1.5 text-left text-[11px] text-gray-200 transition-colors hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-35"
          onClick={() => {
            if (!canOpenFolder) return;
            onOpenFolder();
            onClose();
          }}
        >
          打开资产文件夹
        </button>
      ) : null}
      {onAddToComposeInput ? (
        <button
          type="button"
          disabled={!canAddToComposeInput}
          className="block w-full px-2.5 py-1.5 text-left text-[11px] text-gray-200 transition-colors hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-35"
          onClick={() => {
            if (!canAddToComposeInput) return;
            onAddToComposeInput();
            onClose();
          }}
        >
          添加到输入框
        </button>
      ) : null}
    </div>,
    document.body
  );
}
