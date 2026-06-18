import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const SPOTLIGHT_DIM = 'rgba(0,0,0,0.58)';

type ListSpotlightRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

function spotlightRectsEqual(a: ListSpotlightRect | null, b: ListSpotlightRect): boolean {
  if (!a) return false;
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
}

function pointInRect(x: number, y: number, r: ListSpotlightRect): boolean {
  return x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height;
}

export type WorkflowSpaceMarqueeChromeProps = {
  active: boolean;
  listPaneRef: React.RefObject<HTMLElement | null>;
  /** 卷轴 pane 变化时需重算列表在视口中的位置 */
  workspacePane: number;
  /** 在暗区或列表区内按下以开始框选 */
  onMarqueePointerDown: (
    clientX: number,
    clientY: number,
    pointerId: number,
    captureEl: HTMLElement
  ) => void;
  /** 暗区滚轮：转发到资产列表（列表区内走原生滚动，不经过此回调） */
  onDimWheel?: (e: React.WheelEvent<HTMLDivElement>) => void;
};

/**
 * 空格框选：全屏压暗 + 列表区镂空。
 * - 列表洞不拦截 wheel → 原生滚动（更跟手）
 * - 暗区 wheel 由父级平滑转发
 * - 列表洞内 pointer 用 capture 开始框选
 */
export default function WorkflowSpaceMarqueeChrome({
  active,
  listPaneRef,
  workspacePane,
  onMarqueePointerDown,
  onDimWheel,
}: WorkflowSpaceMarqueeChromeProps) {
  const maskId = useId().replace(/:/g, '');
  const maskBackdropRef = useRef<SVGRectElement | null>(null);
  const maskHoleRef = useRef<SVGRectElement | null>(null);
  const spotlightRef = useRef<ListSpotlightRect | null>(null);
  const [spotlight, setSpotlight] = useState<ListSpotlightRect | null>(null);
  const onMarqueePointerDownRef = useRef(onMarqueePointerDown);
  onMarqueePointerDownRef.current = onMarqueePointerDown;

  const syncMaskDom = (r: ListSpotlightRect | null) => {
    const backdrop = maskBackdropRef.current;
    const hole = maskHoleRef.current;
    if (!backdrop || !hole || typeof window === 'undefined') return;

    backdrop.setAttribute('width', String(window.innerWidth));
    backdrop.setAttribute('height', String(window.innerHeight));

    if (!r || r.width < 1 || r.height < 1) {
      hole.setAttribute('width', '0');
      hole.setAttribute('height', '0');
      return;
    }
    hole.setAttribute('x', String(r.left));
    hole.setAttribute('y', String(r.top));
    hole.setAttribute('width', String(r.width));
    hole.setAttribute('height', String(r.height));
  };

  useLayoutEffect(() => {
    if (!active || typeof window === 'undefined') {
      spotlightRef.current = null;
      setSpotlight(null);
      return;
    }

    const update = () => {
      const el = listPaneRef.current;
      if (!el) {
        spotlightRef.current = null;
        setSpotlight(null);
        syncMaskDom(null);
        return;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) {
        spotlightRef.current = null;
        setSpotlight(null);
        syncMaskDom(null);
        return;
      }
      const next: ListSpotlightRect = {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      };
      spotlightRef.current = next;
      syncMaskDom(next);
      setSpotlight((prev) => (spotlightRectsEqual(prev, next) ? prev : next));
    };

    update();
    window.addEventListener('resize', update);
    const ro =
      typeof ResizeObserver !== 'undefined' && listPaneRef.current
        ? new ResizeObserver(update)
        : null;
    if (listPaneRef.current && ro) ro.observe(listPaneRef.current);

    return () => {
      window.removeEventListener('resize', update);
      ro?.disconnect();
    };
  }, [active, listPaneRef, workspacePane]);

  /** 列表洞内无遮罩层：capture 阶段开始框选 */
  useLayoutEffect(() => {
    if (!active || typeof document === 'undefined') return;

    const onDocPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const spot = spotlightRef.current;
      if (!spot || !pointInRect(e.clientX, e.clientY, spot)) return;
      const t = e.target as Element | null;
      if (
        t?.closest(
          'button, [role="button"], a, input, select, textarea, label, [contenteditable="true"]'
        )
      ) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      onMarqueePointerDownRef.current(e.clientX, e.clientY, e.pointerId, document.body);
    };

    document.addEventListener('pointerdown', onDocPointerDown, true);
    return () => document.removeEventListener('pointerdown', onDocPointerDown, true);
  }, [active]);

  if (!active || !spotlight || typeof document === 'undefined') return null;

  const { left, top, width, height } = spotlight;
  const bottomTop = top + height;
  const rightLeft = left + width;

  const dimPanelProps = {
    className: 'fixed z-[143] cursor-crosshair touch-none select-none',
    'aria-hidden': true as const,
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    },
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      onMarqueePointerDown(e.clientX, e.clientY, e.pointerId, e.currentTarget);
    },
    onWheel: onDimWheel,
  };

  return createPortal(
    <>
      <div {...dimPanelProps} style={{ left: 0, top: 0, right: 0, height: top }} />
      <div {...dimPanelProps} style={{ left: 0, top: bottomTop, right: 0, bottom: 0 }} />
      <div {...dimPanelProps} style={{ left: 0, top, width: left, height }} />
      <div {...dimPanelProps} style={{ left: rightLeft, top, right: 0, height }} />
      <svg
        className="pointer-events-none fixed inset-0 z-[140] h-full w-full"
        aria-hidden
      >
        <defs>
          <mask id={maskId} maskUnits="userSpaceOnUse">
            <rect ref={maskBackdropRef} x="0" y="0" width="0" height="0" fill="white" />
            <rect ref={maskHoleRef} x="0" y="0" width="0" height="0" fill="black" />
          </mask>
        </defs>
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill={SPOTLIGHT_DIM}
          mask={`url(#${maskId})`}
        />
      </svg>
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[142] flex justify-center px-4">
        <div className="rounded-full border border-white/10 bg-[#0f0f12]/95 px-4 py-2 text-center shadow-lg">
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
