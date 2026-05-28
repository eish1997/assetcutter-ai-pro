import React, { type RefObject } from 'react';
import type { StoryboardTableRow } from '../../types';
import StoryboardFrameCompositeCard from './StoryboardFrameCompositeCard';
import {
  STORYBOARD_BODY_SCROLL,
  STORYBOARD_COLUMN_HEAD,
  STORYBOARD_COLUMN_HINT,
  STORYBOARD_COMPOSITE_RAIL_W,
  STORYBOARD_GAP_STACK,
  STORYBOARD_SIDE_RAIL,
} from './storyboardTableUi';

type Props = {
  rows: StoryboardTableRow[];
  rowHeights: Record<string, number>;
  activeRowId: string | null;
  onSelect: (rowId: string) => void;
  onPreviewImage: (src: string) => void;
  scrollRef?: RefObject<HTMLDivElement | null>;
};

export default function StoryboardTableCompositeColumn({
  rows,
  rowHeights,
  activeRowId,
  onSelect,
  onPreviewImage,
  scrollRef,
}: Props) {
  return (
    <aside className={`${STORYBOARD_SIDE_RAIL} ${STORYBOARD_COMPOSITE_RAIL_W} shrink-0`}>
      <div className="shrink-0 px-0.5">
        <p className={STORYBOARD_COLUMN_HEAD}>分镜合成</p>
        <p className={STORYBOARD_COLUMN_HINT}>实时预览</p>
      </div>
      <div
        ref={scrollRef}
        className={`${STORYBOARD_BODY_SCROLL} flex flex-col pr-0.5 ${STORYBOARD_GAP_STACK}`}
      >
        {rows.map((row, i) => (
          <StoryboardFrameCompositeCard
            key={row.id}
            row={row}
            index={i}
            syncHeight={rowHeights[row.id]}
            active={activeRowId === row.id}
            onSelect={() => onSelect(row.id)}
            onPreviewImage={onPreviewImage}
          />
        ))}
      </div>
    </aside>
  );
}
