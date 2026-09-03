import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { computeContextMenuPosition } from '../../services/floatingMenuPosition';

export type WorkshopFolderMenuTarget =
  | { kind: 'root'; root: string; label: string }
  | { kind: 'dir'; root: string; rel: string; name: string };

const ITEM =
  'block w-full px-2.5 py-1.5 text-left text-[11px] text-gray-200 transition-colors hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-35';

export function WorkshopFolderContextMenu(props: {
  open: boolean;
  x: number;
  y: number;
  target: WorkshopFolderMenuTarget | null;
  flatten: boolean;
  canPaste: boolean;
  onClose: () => void;
  onReveal: () => void;
  onCopyPath: () => void;
  onRemoveRoot?: () => void;
  onMkdir?: () => void;
  onRename?: () => void;
  onTrash?: () => void;
  onCut?: () => void;
  onCopy?: () => void;
  onPaste?: () => void;
  onToggleFlatten: () => void;
}): React.ReactElement | null {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: props.x, top: props.y });
  const isRoot = props.target?.kind === 'root';

  useLayoutEffect(() => {
    if (!props.open) {
      setPosition({ left: props.x, top: props.y });
      return;
    }
    const el = menuRef.current;
    if (!el) {
      setPosition({ left: props.x, top: props.y });
      return;
    }
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    setPosition(computeContextMenuPosition(props.x, props.y, rect.width, rect.height, vw, vh));
  }, [props.open, props.x, props.y, props.target]);

  useEffect(() => {
    if (!props.open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') props.onClose();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-workshop-folder-context-menu="1"]')) return;
      props.onClose();
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [props.onClose, props.open]);

  if (!props.open || !props.target || typeof document === 'undefined') return null;

  const run = (fn?: () => void) => {
    fn?.();
    props.onClose();
  };

  return createPortal(
    <div
      ref={menuRef}
      data-workshop-folder-context-menu="1"
      data-ac-allow-context-menu
      className="fixed z-[2600] min-w-[10.5rem] max-w-[16rem] overflow-hidden rounded-xl border border-white/[0.08] bg-[#0f0f0f] py-1 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.75)]"
      style={{ left: position.left, top: position.top }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button type="button" className={ITEM} onClick={() => run(props.onReveal)}>
        在资源管理器中打开
      </button>
      <button type="button" className={ITEM} onClick={() => run(props.onCopyPath)}>
        复制路径
      </button>
      {isRoot ? (
        <button type="button" className={ITEM} onClick={() => run(props.onRemoveRoot)}>
          从库中移除
        </button>
      ) : (
        <>
          <button type="button" className={ITEM} onClick={() => run(props.onMkdir)}>
            新建文件夹
          </button>
          <button type="button" className={ITEM} onClick={() => run(props.onRename)}>
            重命名
          </button>
          <button type="button" className={ITEM} onClick={() => run(props.onCut)}>
            剪切
          </button>
          <button type="button" className={ITEM} onClick={() => run(props.onCopy)}>
            复制
          </button>
          <button type="button" className={ITEM} disabled={!props.canPaste} onClick={() => run(props.onPaste)}>
            粘贴
          </button>
          <button type="button" className={ITEM} onClick={() => run(props.onTrash)}>
            删除
          </button>
        </>
      )}
      <div className="my-1 h-px bg-white/[0.08]" />
      <button type="button" className={ITEM} onClick={() => run(props.onToggleFlatten)}>
        <span className="flex items-center justify-between gap-3">
          显示子文件夹资产
          <span className="text-[9px] text-[#c9a36a]">{props.flatten ? '✓' : ''}</span>
        </span>
      </button>
    </div>,
    document.body,
  );
}
