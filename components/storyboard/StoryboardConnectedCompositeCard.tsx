import React, { memo } from 'react';
import type { StoryboardTableRow } from '../../types';
import StoryboardFrameCompositeCard from './StoryboardFrameCompositeCard';

type Props = {
  row: StoryboardTableRow;
  index: number;
  syncHeight?: number;
  active: boolean;
  onSelect: () => void;
  onPreviewImage: (src: string) => void;
};

function StoryboardConnectedCompositeCardInner({
  row,
  index,
  syncHeight,
  active,
  onSelect,
  onPreviewImage,
}: Props) {
  return (
    <StoryboardFrameCompositeCard
      row={row}
      index={index}
      layout="rail"
      syncHeight={syncHeight}
      active={active}
      onSelect={onSelect}
      onPreviewImage={onPreviewImage}
    />
  );
}

function compositePropsEqual(prev: Props, next: Props): boolean {
  if (
    prev.index !== next.index ||
    prev.syncHeight !== next.syncHeight ||
    prev.active !== next.active
  ) {
    return false;
  }
  const a = prev.row;
  const b = next.row;
  return (
    a.id === b.id &&
    a.shotNo === b.shotNo &&
    a.durationSec === b.durationSec &&
    a.shotText === b.shotText &&
    a.frameImage === b.frameImage &&
    a.frameImageObjectKey === b.frameImageObjectKey &&
    a.frameImageCompanionKey === b.frameImageCompanionKey &&
    a.locked === b.locked
  );
}

const StoryboardConnectedCompositeCard = memo(
  StoryboardConnectedCompositeCardInner,
  compositePropsEqual
);
export default StoryboardConnectedCompositeCard;
