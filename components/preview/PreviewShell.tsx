import React, { forwardRef, useCallback, useEffect, useLayoutEffect, useRef } from 'react';

function isEscapeKey(e: KeyboardEvent): boolean {
  return e.key === 'Escape' || e.code === 'Escape' || e.keyCode === 27;
}

function assignRef<T>(ref: React.ForwardedRef<T>, node: T | null) {
  if (typeof ref === 'function') ref(node);
  else if (ref) (ref as React.MutableRefObject<T | null>).current = node;
}

export type PreviewShellProps = {
  open: boolean;
  onClose: () => void;
  /** 打开或切换资产时触发，用于把焦点拉回壳层（避免 Esc 被输入框吃掉） */
  focusKey?: string | number;
  children: React.ReactNode;
  /** 覆盖层 z-index 类名 */
  zIndexClassName?: string;
};

/**
 * 预览通用外壳：遮罩、焦点、Esc、右键菜单拦截、点击背景关闭。
 * 具体 Viewer（平面 / 全景 / 未来 3D）放在 children 内。
 */
export const PreviewShell = forwardRef<HTMLDivElement, PreviewShellProps>(function PreviewShell(
  { open, onClose, focusKey, children, zIndexClassName = 'z-[2000]' },
  ref
) {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useLayoutEffect(() => {
    if (!open) return;
    const onEscCapture = (e: KeyboardEvent) => {
      if (!isEscapeKey(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onCloseRef.current();
    };
    const onEscCaptureUp = (e: KeyboardEvent) => {
      if (!isEscapeKey(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onCloseRef.current();
    };
    document.addEventListener('keydown', onEscCapture, true);
    window.addEventListener('keydown', onEscCapture, true);
    document.addEventListener('keyup', onEscCaptureUp, true);
    window.addEventListener('keyup', onEscCaptureUp, true);
    return () => {
      document.removeEventListener('keydown', onEscCapture, true);
      window.removeEventListener('keydown', onEscCapture, true);
      document.removeEventListener('keyup', onEscCaptureUp, true);
      window.removeEventListener('keyup', onEscCaptureUp, true);
    };
  }, [open]);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const setRootRef = useCallback(
    (node: HTMLDivElement | null) => {
      rootRef.current = node;
      assignRef(ref, node);
    },
    [ref]
  );

  useLayoutEffect(() => {
    if (!open) return;
    rootRef.current?.focus({ preventScroll: true });
  }, [open, focusKey]);

  useEffect(() => {
    if (!open) return;
    const blockContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('contextmenu', blockContextMenu, true);
    return () => window.removeEventListener('contextmenu', blockContextMenu, true);
  }, [open]);

  if (!open) return null;

  return (
    <div
      ref={setRootRef}
      tabIndex={-1}
      role="dialog"
      aria-modal
      className={`fixed inset-0 ${zIndexClassName} bg-black/72 backdrop-blur-sm animate-in fade-in outline-none`}
      data-ac-block-workflow-marquee
      onKeyDownCapture={(e) => {
        if (!isEscapeKey(e)) return;
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
      }}
      onClick={onClose}
      onContextMenuCapture={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div
        className="relative w-full h-full overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onContextMenuCapture={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        {children}
      </div>
    </div>
  );
});
