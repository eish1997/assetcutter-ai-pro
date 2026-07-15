import React from 'react';
import { WORKFLOW_LIGHTBOX_RIGHT_PANEL_WIDTH_CLASS } from './workflowSectionUiConstants';

export type WorkflowLightboxDetailEdgePanelProps = {
  /** 详情滚动区上方：高度 3D / 3D 模型工具条等 */
  headerSlot?: React.ReactNode;
  heightfieldToolbarHostRef?: React.RefObject<HTMLDivElement | null>;
  heightfieldToolbarHostClassName?: string;
  /** 距右缘偏移（如资产缩略图条 `right-14`） */
  edgeRightClassName?: string;
  children: React.ReactNode;
};

/**
 * 大图预览右侧详情：默认仅贴右缘图标条；指针移入展开，移出收起。
 */
export default function WorkflowLightboxDetailEdgePanel({
  headerSlot,
  heightfieldToolbarHostRef,
  heightfieldToolbarHostClassName = 'hidden',
  edgeRightClassName = 'right-0',
  children,
}: WorkflowLightboxDetailEdgePanelProps) {
  return (
    <div
      className={`absolute ${edgeRightClassName} z-[9] flex max-h-[72vh] min-h-0 items-stretch`}
      style={{ top: 'max(3.5rem, env(safe-area-inset-top, 0px))' }}
    >
      <div
        className={[
          'flex min-h-0 min-w-0 flex-col overflow-hidden',
          `${WORKFLOW_LIGHTBOX_RIGHT_PANEL_WIDTH_CLASS} max-w-[calc(100vw-2.75rem)] opacity-100 visible pointer-events-auto`,
        ].join(' ')}
      >
        <div
          className={[
            'flex min-h-0 flex-col gap-2 pr-0.5',
            WORKFLOW_LIGHTBOX_RIGHT_PANEL_WIDTH_CLASS,
            'max-h-[72vh] max-w-[calc(100vw-2.75rem)]',
            'transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform translate-x-0',
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
