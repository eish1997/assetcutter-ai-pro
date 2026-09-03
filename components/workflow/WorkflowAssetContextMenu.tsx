import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { computeContextMenuPosition } from '../../services/floatingMenuPosition';

const ITEM =
  'block w-full px-2.5 py-1.5 text-left text-[11px] text-gray-200 transition-colors hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-35';

export type WorkflowAssetContextMenuProps = {
  open: boolean;
  x: number;
  y: number;
  canCopyImage?: boolean;
  onCopyImage?: () => void;
  onCopyId?: () => void;
  canOpenFolder?: boolean;
  openFolderDisabledReason?: string;
  onOpenFolder?: () => void;
  canAddToComposeInput?: boolean;
  onAddToComposeInput?: () => void;
  onOpen?: () => void;
  openLabel?: string;
  onReveal?: () => void;
  canReveal?: boolean;
  revealDisabledReason?: string;
  onCopyPath?: () => void;
  onDelete?: () => void;
  onRename?: () => void;
  onCut?: () => void;
  onCopyEntry?: () => void;
  onPaste?: () => void;
  canPaste?: boolean;
  onClose: () => void;
};

export default function WorkflowAssetContextMenu({
  open,
  x,
  y,
  canCopyImage = false,
  onCopyImage,
  onCopyId,
  canOpenFolder = false,
  openFolderDisabledReason = '',
  onOpenFolder,
  canAddToComposeInput = false,
  onAddToComposeInput,
  onOpen,
  openLabel = '打开',
  onReveal,
  canReveal = true,
  revealDisabledReason = '',
  onCopyPath,
  onDelete,
  onRename,
  onCut,
  onCopyEntry,
  onPaste,
  canPaste = false,
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
    setPosition(computeContextMenuPosition(x, y, rect.width, rect.height, window.innerWidth, window.innerHeight));
  }, [open, x, y, canAddToComposeInput, canCopyImage, canOpenFolder, onOpen, onReveal, onCopyPath, onDelete]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => {
      const el = menuRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setPosition(computeContextMenuPosition(x, y, rect.width, rect.height, window.innerWidth, window.innerHeight));
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

  const run = (fn?: () => void, ok = true) => {
    if (!ok || !fn) return;
    fn();
    onClose();
  };

  return createPortal(
    <div
      ref={menuRef}
      data-workflow-asset-context-menu="1"
      data-ac-allow-context-menu
      className="fixed z-[2600] min-w-[10.5rem] max-w-[16rem] overflow-hidden rounded-xl border border-white/[0.08] bg-[#0f0f0f] py-1 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.75)]"
      style={{ left: position.left, top: position.top }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {onOpen ? (
        <button type="button" className={ITEM} onClick={() => run(onOpen)}>
          {openLabel}
        </button>
      ) : null}
      {onReveal ? (
        <button
          type="button"
          disabled={!canReveal}
          title={!canReveal ? revealDisabledReason || '无法在资源管理器中打开' : revealDisabledReason || undefined}
          className={ITEM}
          onClick={() => run(onReveal, canReveal)}
        >
          在资源管理器中打开
        </button>
      ) : onOpenFolder ? (
        <button
          type="button"
          disabled={!canOpenFolder}
          title={!canOpenFolder ? openFolderDisabledReason || '当前资产尚未落到本地，无法打开资产文件夹' : openFolderDisabledReason || undefined}
          className={ITEM}
          onClick={() => run(onOpenFolder, canOpenFolder)}
        >
          打开资产文件夹
        </button>
      ) : null}
      {onCopyPath ? (
        <button type="button" className={ITEM} onClick={() => run(onCopyPath)}>
          复制完整路径
        </button>
      ) : null}
      {onCopyImage ? (
        <button type="button" disabled={!canCopyImage} className={ITEM} onClick={() => run(onCopyImage, canCopyImage)}>
          复制
        </button>
      ) : null}
      {onCopyId ? (
        <button type="button" className={ITEM} onClick={() => run(onCopyId)}>
          复制 ID
        </button>
      ) : null}
      {onAddToComposeInput ? (
        <button
          type="button"
          disabled={!canAddToComposeInput}
          className={ITEM}
          onClick={() => run(onAddToComposeInput, canAddToComposeInput)}
        >
          添加到输入框
        </button>
      ) : null}
      {onRename || onCut || onCopyEntry || onPaste || onDelete ? <div className="my-1 h-px bg-white/[0.08]" /> : null}
      {onRename ? (
        <button type="button" className={ITEM} onClick={() => run(onRename)}>
          重命名
        </button>
      ) : null}
      {onCut ? (
        <button type="button" className={ITEM} onClick={() => run(onCut)}>
          剪切
        </button>
      ) : null}
      {onCopyEntry ? (
        <button type="button" className={ITEM} onClick={() => run(onCopyEntry)}>
          复制文件
        </button>
      ) : null}
      {onPaste ? (
        <button type="button" disabled={!canPaste} className={ITEM} onClick={() => run(onPaste, canPaste)}>
          粘贴
        </button>
      ) : null}
      {onDelete ? (
        <button type="button" className={ITEM} onClick={() => run(onDelete)}>
          删除
        </button>
      ) : null}
    </div>,
    document.body,
  );
}
