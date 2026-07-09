import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const SPOTLIGHT_DIM = 'rgba(0,0,0,0.58)';

type ViewportRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

function viewportRectsEqual(a: ViewportRect | null, b: ViewportRect): boolean {
  if (!a) return false;
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
}

function pointInRect(x: number, y: number, r: ViewportRect): boolean {
  return x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height;
}

function rectFromDom(el: HTMLElement | null): ViewportRect | null {
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return null;
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

/** 水平条带（顶/底暗区）在侧栏 x 范围挖洞 */
function horizontalDimSlices(
  bandTop: number,
  bandHeight: number,
  exclude: ViewportRect | null
): ViewportRect[] {
  if (bandHeight < 1 || typeof window === 'undefined') return [];
  const vw = window.innerWidth;
  if (!exclude || exclude.width < 1 || exclude.height < 1) {
    return [{ left: 0, top: bandTop, width: vw, height: bandHeight }];
  }
  const overlapsY = exclude.top < bandTop + bandHeight && bandTop < exclude.top + exclude.height;
  if (!overlapsY) {
    return [{ left: 0, top: bandTop, width: vw, height: bandHeight }];
  }
  const slices: ViewportRect[] = [];
  if (exclude.left > 0) {
    slices.push({ left: 0, top: bandTop, width: exclude.left, height: bandHeight });
  }
  const excludeRight = exclude.left + exclude.width;
  if (excludeRight < vw) {
    slices.push({ left: excludeRight, top: bandTop, width: vw - excludeRight, height: bandHeight });
  }
  return slices;
}

export type WorkflowSpaceMarqueeChromeProps = {
  active: boolean;
  listPaneRef: React.RefObject<HTMLElement | null>;
  /** 快捷栏对话侧栏：框选暗区不覆盖、不拦截点击 */
  sidebarExcludeRef?: React.RefObject<HTMLElement | null>;
  /** 小盒子页切换时需重算列表在视口中的位置 */
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
 * - 快捷栏侧栏（`sidebarExcludeRef`）不参与框选遮罩
 */
export default function WorkflowSpaceMarqueeChrome({
  active,
  listPaneRef,
  sidebarExcludeRef,
  workspacePane,
  onMarqueePointerDown,
  onDimWheel,
}: WorkflowSpaceMarqueeChromeProps) {
  const maskId = useId().replace(/:/g, '');
  const maskBackdropRef = useRef<SVGRectElement | null>(null);
  const maskHoleRef = useRef<SVGRectElement | null>(null);
  const maskSidebarHoleRef = useRef<SVGRectElement | null>(null);
  const spotlightRef = useRef<ViewportRect | null>(null);
  const sidebarExcludeRefState = useRef<ViewportRect | null>(null);
  const [spotlight, setSpotlight] = useState<ViewportRect | null>(null);
  const [sidebarExclude, setSidebarExclude] = useState<ViewportRect | null>(null);
  const onMarqueePointerDownRef = useRef(onMarqueePointerDown);
  onMarqueePointerDownRef.current = onMarqueePointerDown;

  const syncMaskDom = (list: ViewportRect | null, sidebar: ViewportRect | null) => {
    const backdrop = maskBackdropRef.current;
    const hole = maskHoleRef.current;
    const sidebarHole = maskSidebarHoleRef.current;
    if (!backdrop || !hole || !sidebarHole || typeof window === 'undefined') return;

    backdrop.setAttribute('width', String(window.innerWidth));
    backdrop.setAttribute('height', String(window.innerHeight));

    if (!list || list.width < 1 || list.height < 1) {
      hole.setAttribute('width', '0');
      hole.setAttribute('height', '0');
    } else {
      hole.setAttribute('x', String(list.left));
      hole.setAttribute('y', String(list.top));
      hole.setAttribute('width', String(list.width));
      hole.setAttribute('height', String(list.height));
    }

    if (!sidebar || sidebar.width < 1 || sidebar.height < 1) {
      sidebarHole.setAttribute('width', '0');
      sidebarHole.setAttribute('height', '0');
    } else {
      sidebarHole.setAttribute('x', String(sidebar.left));
      sidebarHole.setAttribute('y', String(sidebar.top));
      sidebarHole.setAttribute('width', String(sidebar.width));
      sidebarHole.setAttribute('height', String(sidebar.height));
    }
  };

  useLayoutEffect(() => {
    if (!active || typeof window === 'undefined') {
      spotlightRef.current = null;
      sidebarExcludeRefState.current = null;
      setSpotlight(null);
      setSidebarExclude(null);
      return;
    }

    const update = () => {
      const list = rectFromDom(listPaneRef.current);
      const sidebar = rectFromDom(sidebarExcludeRef?.current ?? null);
      spotlightRef.current = list;
      sidebarExcludeRefState.current = sidebar;
      syncMaskDom(list, sidebar);
      setSpotlight((prev) => {
        if (!list) return prev === null ? prev : null;
        return viewportRectsEqual(prev, list) ? prev : list;
      });
      setSidebarExclude((prev) => {
        if (!sidebar) return prev === null ? prev : null;
        return viewportRectsEqual(prev, sidebar) ? prev : sidebar;
      });
    };

    update();
    window.addEventListener('resize', update);
    const roList =
      typeof ResizeObserver !== 'undefined' && listPaneRef.current
        ? new ResizeObserver(update)
        : null;
    if (listPaneRef.current && roList) roList.observe(listPaneRef.current);
    const roSidebar =
      typeof ResizeObserver !== 'undefined' && sidebarExcludeRef?.current
        ? new ResizeObserver(update)
        : null;
    if (sidebarExcludeRef?.current && roSidebar) roSidebar.observe(sidebarExcludeRef.current);

    return () => {
      window.removeEventListener('resize', update);
      roList?.disconnect();
      roSidebar?.disconnect();
    };
  }, [active, listPaneRef, sidebarExcludeRef, workspacePane]);

  /** 列表洞内无遮罩层：capture 阶段开始框选 */
  useLayoutEffect(() => {
    if (!active || typeof document === 'undefined') return;

    const onDocPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const sidebar = sidebarExcludeRefState.current;
      if (sidebar && pointInRect(e.clientX, e.clientY, sidebar)) return;
      const spot = spotlightRef.current;
      if (!spot || !pointInRect(e.clientX, e.clientY, spot)) return;
      const t = e.target as Element | null;
      if (t?.closest('[data-ac-block-workflow-marquee]')) return;
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
  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 0;

  const dimPanelProps = {
    className: 'fixed z-[143] cursor-crosshair touch-none select-none',
    'aria-hidden': true as const,
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    },
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const sidebar = sidebarExcludeRefState.current;
      if (sidebar && pointInRect(e.clientX, e.clientY, sidebar)) return;
      if ((e.target as Element).closest('[data-ac-block-workflow-marquee]')) return;
      e.preventDefault();
      e.stopPropagation();
      onMarqueePointerDown(e.clientX, e.clientY, e.pointerId, e.currentTarget);
    },
    onWheel: onDimWheel,
  };

  const dimPanels: React.ReactNode[] = [];
  for (const slice of horizontalDimSlices(0, top, sidebarExclude)) {
    dimPanels.push(
      <div
        key={`top-${slice.left}-${slice.width}`}
        {...dimPanelProps}
        style={{ left: slice.left, top: slice.top, width: slice.width, height: slice.height }}
      />
    );
  }
  for (const slice of horizontalDimSlices(bottomTop, viewportH - bottomTop, sidebarExclude)) {
    dimPanels.push(
      <div
        key={`bottom-${slice.left}-${slice.width}`}
        {...dimPanelProps}
        style={{ left: slice.left, top: slice.top, width: slice.width, height: slice.height }}
      />
    );
  }
  if (left > 0) {
    dimPanels.push(
      <div key="left" {...dimPanelProps} style={{ left: 0, top, width: left, height }} />
    );
  }
  const rightWidth =
    sidebarExclude && sidebarExclude.left > rightLeft
      ? sidebarExclude.left - rightLeft
      : typeof window !== 'undefined'
        ? window.innerWidth - rightLeft
        : 0;
  if (rightWidth > 0 && (!sidebarExclude || sidebarExclude.left > rightLeft)) {
    dimPanels.push(
      <div
        key="right"
        {...dimPanelProps}
        style={{ left: rightLeft, top, width: rightWidth, height }}
      />
    );
  }

  return createPortal(
    <>
      {dimPanels}
      <svg className="pointer-events-none fixed inset-0 z-[140] h-full w-full" aria-hidden>
        <defs>
          <mask id={maskId} maskUnits="userSpaceOnUse">
            <rect ref={maskBackdropRef} x="0" y="0" width="0" height="0" fill="white" />
            <rect ref={maskHoleRef} x="0" y="0" width="0" height="0" fill="black" />
            <rect ref={maskSidebarHoleRef} x="0" y="0" width="0" height="0" fill="black" />
          </mask>
        </defs>
        <rect x="0" y="0" width="100%" height="100%" fill={SPOTLIGHT_DIM} mask={`url(#${maskId})`} />
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
