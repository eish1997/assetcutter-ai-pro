import { Fragment, useLayoutEffect, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { useWorkflowJustifiedVirtualScroll } from '../../hooks/useWorkflowJustifiedVirtualScroll';
import type { WorkflowJustifiedLayoutBox } from '../../services/workflowJustifiedLayout';
import type { ClientRectLike } from '../../services/workflowJustifiedScroll';

export type WorkflowJustifiedMarqueeHitFn = (sel: ClientRectLike) => string[] | null;

export function WorkflowJustifiedVirtualGrid({
  scrollRef,
  gridRef,
  boxes,
  ready,
  totalHeight,
  className,
  style,
  marqueeHitIdsRef,
  renderBox,
  children,
}: {
  scrollRef: RefObject<HTMLElement | null>;
  gridRef: RefObject<HTMLDivElement | null>;
  boxes: WorkflowJustifiedLayoutBox[];
  ready: boolean;
  totalHeight: number;
  className?: string;
  style?: CSSProperties;
  marqueeHitIdsRef?: RefObject<WorkflowJustifiedMarqueeHitFn | null>;
  renderBox: (box: WorkflowJustifiedLayoutBox, ctx: { virtualize: boolean }) => ReactNode;
  children?: ReactNode;
}) {
  const { isBoxVisible, layoutMarqueeHitIds, virtualize } = useWorkflowJustifiedVirtualScroll(scrollRef, gridRef, {
    boxes: ready ? boxes : [],
  });

  useLayoutEffect(() => {
    if (!marqueeHitIdsRef) return;
    marqueeHitIdsRef.current = layoutMarqueeHitIds;
    return () => {
      if (marqueeHitIdsRef.current === layoutMarqueeHitIds) {
        marqueeHitIdsRef.current = null;
      }
    };
  }, [layoutMarqueeHitIds, marqueeHitIdsRef]);

  const visibleBoxes = ready ? boxes.filter((box) => isBoxVisible(box.id)) : [];

  return (
    <div
      ref={gridRef}
      className={className}
      style={{
        height: ready ? totalHeight : undefined,
        ...style,
      }}
    >
      {children}
      {visibleBoxes.map((box) => (
        <Fragment key={box.id}>{renderBox(box, { virtualize })}</Fragment>
      ))}
    </div>
  );
}
