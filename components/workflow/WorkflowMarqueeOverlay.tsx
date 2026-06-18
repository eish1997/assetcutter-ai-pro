import { createPortal } from 'react-dom';
import type { RefObject } from 'react';

export type WorkflowMarqueeOverlayProps = {
  rectRef: RefObject<SVGRectElement | null>;
};

/** 常挂载于 body：框选仅改 SVG 属性，避免 marquee 启停触发 WorkflowSection 重渲染 */
export default function WorkflowMarqueeOverlay({ rectRef }: WorkflowMarqueeOverlayProps) {
  if (typeof document === 'undefined') return null;

  return createPortal(
    <svg
      className="fixed inset-0 h-full w-full pointer-events-none z-[150]"
      aria-hidden
    >
      <rect
        ref={rectRef}
        fill="none"
        stroke="#4570b0"
        strokeWidth={2}
        rx={3}
        visibility="hidden"
        vectorEffect="nonScalingStroke"
      />
    </svg>,
    document.body
  );
}
