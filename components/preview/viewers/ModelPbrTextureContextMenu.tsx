import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { computeContextMenuPosition } from '../../../services/floatingMenuPosition';

export type ModelPbrTextureContextMenuProps = {
  open: boolean;
  x: number;
  y: number;
  canDelete?: boolean;
  canOpenFolder?: boolean;
  openFolderDisabledReason?: string;
  onDelete?: () => void;
  onDownload: () => void;
  onAddToCompose: () => void;
  onCopy: () => void;
  onCopyId: () => void;
  onOpenFolder?: () => void;
  onClose: () => void;
};

const itemCls =
  'block w-full rounded-md px-2.5 py-1.5 text-left text-[11px] text-gray-200 transition-colors hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-35';

/** PBR 贴图（候选 / 材质槽预览）共用右键菜单 */
export default function ModelPbrTextureContextMenu({
  open,
  x,
  y,
  canDelete = true,
  canOpenFolder = false,
  openFolderDisabledReason = '',
  onDelete,
  onDownload,
  onAddToCompose,
  onCopy,
  onCopyId,
  onOpenFolder,
  onClose,
}: ModelPbrTextureContextMenuProps) {
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
    setPosition(computeContextMenuPosition(x, y, rect.width, rect.height, window.innerWidth, window.innerHeight));
  }, [open, x, y, canDelete, canOpenFolder]);

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
      if (target?.closest('[data-model-pbr-texture-context-menu="1"]')) return;
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
      data-model-pbr-texture-context-menu="1"
      data-model-pbr-candidate-menu
      data-ac-allow-context-menu
      className="fixed z-[2600] min-w-[9.5rem] max-w-[14rem] overflow-hidden rounded-xl border border-white/[0.08] bg-[#0f0f12] p-1 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.75)] ring-1 ring-white/[0.05]"
      style={{ left: position.left, top: position.top }}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(e) => e.stopPropagation()}
    >
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
      <button
        type="button"
        role="menuitem"
        className={itemCls}
        onClick={() => {
          onDownload();
          onClose();
        }}
      >
        下载原图
      </button>
      <button
        type="button"
        role="menuitem"
        className={itemCls}
        onClick={() => {
          onAddToCompose();
          onClose();
        }}
      >
        添加到输入框
      </button>
      <button
        type="button"
        role="menuitem"
        className={itemCls}
        onClick={() => {
          onCopy();
          onClose();
        }}
      >
        复制
      </button>
      <button
        type="button"
        role="menuitem"
        className={itemCls}
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
          role="menuitem"
          disabled={!canOpenFolder}
          title={
            !canOpenFolder
              ? openFolderDisabledReason || '当前资产尚未落到本地，无法打开资产文件夹'
              : openFolderDisabledReason || undefined
          }
          className={itemCls}
          onClick={() => {
            if (!canOpenFolder) return;
            onOpenFolder();
            onClose();
          }}
        >
          打开资产文件夹
        </button>
      ) : null}
    </div>,
    document.body
  );
}
