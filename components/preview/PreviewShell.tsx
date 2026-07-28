import React, { forwardRef, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

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
  /** 遮罩底色与模糊（默认与大图预览一致） */
  backdropTintClassName?: string;
  /** 遮罩下的静态底图（如工作流列表卸载前的截图） */
  backdropImageSrc?: string | null;
  /**
   * 全屏壳右侧留白（如工作区快捷侧栏），预览遮罩不覆盖该区域。
   * 例：`min(28rem, 30vw)`；未设时仍为 `inset-0` 全屏。
   */
  shellRightGutter?: string;
  /**
   * 视觉上隐藏壳层但保持挂载（关窗截 3D 缩略图：先露列表，截完再卸载）。
   * 隐藏期间不响应 Esc / 点击关闭。
   */
  visuallyHidden?: boolean;
};

/**
 * 预览通用外壳：遮罩、焦点、Esc、右键菜单拦截、点击背景关闭。
 * 具体 Viewer（平面 / 全景 / 未来 3D）放在 children 内。
 */
export const PreviewShell = forwardRef<HTMLDivElement, PreviewShellProps>(function PreviewShell(
  {
    open,
    onClose,
    focusKey,
    children,
    zIndexClassName = 'z-[2000]',
    backdropTintClassName = 'bg-black/72 backdrop-blur-sm',
    backdropImageSrc,
    shellRightGutter,
    visuallyHidden = false,
  },
  ref
) {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useLayoutEffect(() => {
    if (!open || visuallyHidden) return;
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
  }, [open, visuallyHidden]);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const setRootRef = useCallback(
    (node: HTMLDivElement | null) => {
      rootRef.current = node;
      assignRef(ref, node);
    },
    [ref]
  );

  useLayoutEffect(() => {
    if (!open || visuallyHidden) return;
    rootRef.current?.focus({ preventScroll: true });
  }, [open, focusKey, visuallyHidden]);

  useEffect(() => {
    if (!open || visuallyHidden) return;
    const blockContextMenu = (e: MouseEvent) => {
      if (e.target instanceof Element && e.target.closest('[data-ac-allow-context-menu]')) return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('contextmenu', blockContextMenu, true);
    return () => window.removeEventListener('contextmenu', blockContextMenu, true);
  }, [open, visuallyHidden]);

  if (!open) return null;

  const content = (
    <div
      ref={setRootRef}
      tabIndex={-1}
      role="dialog"
      aria-modal={!visuallyHidden}
      aria-hidden={visuallyHidden || undefined}
      className={`fixed ${shellRightGutter ? 'top-0 left-0 bottom-0' : 'inset-0'} ${zIndexClassName} outline-none ${
        visuallyHidden
          ? 'pointer-events-none opacity-0'
          : 'animate-in fade-in'
      }`}
      style={shellRightGutter ? { right: shellRightGutter } : undefined}
      data-ac-esc-sink={visuallyHidden ? undefined : ''}
      data-ac-block-workflow-marquee={visuallyHidden ? undefined : ''}
      onKeyDownCapture={
        visuallyHidden
          ? undefined
          : (e) => {
              if (!isEscapeKey(e)) return;
              e.preventDefault();
              e.stopPropagation();
              onCloseRef.current();
            }
      }
      onClick={visuallyHidden ? undefined : onClose}
      onContextMenuCapture={
        visuallyHidden
          ? undefined
          : (e) => {
              if (e.target instanceof Element && e.target.closest('[data-ac-allow-context-menu]')) return;
              e.preventDefault();
              e.stopPropagation();
            }
      }
    >
      {backdropImageSrc ? (
        <img
          src={backdropImageSrc}
          alt=""
          draggable={false}
          className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover object-top"
        />
      ) : null}
      <div className={`pointer-events-none absolute inset-0 ${backdropTintClassName}`} aria-hidden />
      <div
        className="relative h-full w-full overflow-hidden"
        onClick={visuallyHidden ? undefined : (e) => e.stopPropagation()}
        onContextMenuCapture={
          visuallyHidden
            ? undefined
            : (e) => {
                if (e.target instanceof Element && e.target.closest('[data-ac-allow-context-menu]')) return;
                e.preventDefault();
                e.stopPropagation();
              }
        }
      >
        {children}
      </div>
    </div>
  );

  if (typeof document === 'undefined') return content;
  return createPortal(content, document.body);
});
