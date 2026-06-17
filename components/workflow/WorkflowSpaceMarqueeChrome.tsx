import React, { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

type ListSpotlightRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type WorkflowSpaceMarqueeChromeProps = {
  active: boolean;
  listPaneRef: React.RefObject<HTMLElement | null>;
  /** 卷轴 pane 变化时需重算列表在视口中的位置 */
  workspacePane: number;
  /** 全屏拦截：暗区不可点穿，任意位置按下即开始框选 */
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  /** 列表区域滚轮仍滚动资产列表 */
  onWheel?: (e: React.WheelEvent<HTMLDivElement>) => void;
};

export default function WorkflowSpaceMarqueeChrome({
  active,
  listPaneRef,
  workspacePane,
  onPointerDown,
  onWheel,
}: WorkflowSpaceMarqueeChromeProps) {
  const [spotlight, setSpotlight] = useState<ListSpotlightRect | null>(null);

  useLayoutEffect(() => {
    if (!active || typeof window === 'undefined') {
      setSpotlight(null);
      return;
    }
    const update = () => {
      const el = listPaneRef.current;
      if (!el) {
        setSpotlight(null);
        return;
      }
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) {
        setSpotlight(null);
        return;
      }
      setSpotlight({
        left: r.left,
        top: r.top,
        width: r.width,
        height: r.height,
      });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    const ro =
      typeof ResizeObserver !== 'undefined' && listPaneRef.current
        ? new ResizeObserver(update)
        : null;
    if (listPaneRef.current && ro) ro.observe(listPaneRef.current);
    let raf = 0;
    const tick = () => {
      update();
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      ro?.disconnect();
      window.cancelAnimationFrame(raf);
    };
  }, [active, listPaneRef, workspacePane]);

  if (!active || !spotlight || typeof document === 'undefined') return null;

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[143] cursor-crosshair touch-none select-none"
        aria-hidden
        onPointerDown={onPointerDown}
        onWheel={onWheel}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      />
      <div
        className="pointer-events-none fixed z-[140]"
        aria-hidden
        style={{
          left: spotlight.left,
          top: spotlight.top,
          width: spotlight.width,
          height: spotlight.height,
          boxShadow: '0 0 0 9999px rgba(0,0,0,0.58)',
        }}
      />
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[142] flex justify-center px-4">
        <div className="rounded-full border border-white/10 bg-[#0f0f12]/92 px-4 py-2 text-center shadow-lg backdrop-blur-md">
          <p className="text-[11px] font-semibold text-gray-100">框选模式</p>
          <p className="mt-0.5 text-[10px] text-gray-400">
            任意位置拖动框选资产 · Alt 减选 · 松开空格退出
          </p>
        </div>
      </div>
    </>,
    document.body
  );
}
