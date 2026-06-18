import React, { useState } from 'react';
import { PanelRight } from 'lucide-react';
import { WORKFLOW_LIGHTBOX_RIGHT_PANEL_WIDTH_CLASS } from './workflowSectionUiConstants';

export type WorkflowLightboxDetailEdgePanelProps = {
  /** 详情滚动区上方：高度 3D / 3D 模型工具条等 */
  headerSlot?: React.ReactNode;
  heightfieldToolbarHostRef?: React.RefObject<HTMLDivElement | null>;
  heightfieldToolbarHostClassName?: string;
  children: React.ReactNode;
};

/**
 * 大图预览右侧详情：默认仅贴右缘图标条；指针移入展开，移出收起。
 */
export default function WorkflowLightboxDetailEdgePanel({
  headerSlot,
  heightfieldToolbarHostRef,
  heightfieldToolbarHostClassName = 'hidden',
  children,
}: WorkflowLightboxDetailEdgePanelProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="absolute right-0 z-[9] flex max-h-[72vh] min-h-0 flex-row-reverse items-stretch"
      style={{ top: 'max(3.5rem, env(safe-area-inset-top, 0px))' }}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      <div
        className={[
          'flex w-9 shrink-0 flex-col items-center justify-center',
          'rounded-l-xl border border-r-0 border-white/10',
          'bg-[#141418]/96 shadow-[-6px_0_28px_rgba(0,0,0,0.42)]',
          'ring-1 ring-inset ring-white/[0.07]',
          'transition-[background-color,box-shadow] duration-200 ease-out',
          expanded ? 'bg-[#18181e]/98 shadow-[-8px_0_32px_rgba(0,0,0,0.5)]' : '',
        ].join(' ')}
        aria-label="详情面板"
        title="移入展开详情 · 移开收起"
      >
        <PanelRight
          size={18}
          strokeWidth={1.75}
          className={[
            'shrink-0 text-gray-300 transition-[transform,color] duration-200 ease-out',
            expanded ? '-translate-x-0.5 text-blue-200/90' : '',
          ].join(' ')}
          aria-hidden
        />
      </div>

      <div
        className={[
          'flex min-h-0 min-w-0 flex-col overflow-hidden',
          'transition-[width,opacity,visibility] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]',
          expanded
            ? `${WORKFLOW_LIGHTBOX_RIGHT_PANEL_WIDTH_CLASS} max-w-[calc(100vw-2.75rem)] opacity-100 visible pointer-events-auto`
            : 'w-0 opacity-0 invisible pointer-events-none',
        ].join(' ')}
        aria-hidden={!expanded}
      >
        <div
          className={[
            'flex min-h-0 flex-col gap-2 pr-0.5',
            WORKFLOW_LIGHTBOX_RIGHT_PANEL_WIDTH_CLASS,
            'max-h-[72vh] max-w-[calc(100vw-2.75rem)]',
            'transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform',
            expanded ? 'translate-x-0' : 'translate-x-2',
          ].join(' ')}
        >
          <div
            ref={heightfieldToolbarHostRef}
            className={heightfieldToolbarHostClassName}
            role="region"
            aria-label="高度 3D 控件"
            onClick={(e) => e.stopPropagation()}
          />
          {headerSlot}
          <div
            className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain rounded-2xl border border-white/10 bg-[#141418] shadow-xl ring-1 ring-black/40 [scrollbar-width:thin]"
            data-image-preview-no-wheel
            data-image-preview-scroll
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
