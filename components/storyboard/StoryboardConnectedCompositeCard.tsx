import React, { memo } from 'react';
import type { StoryboardParseFieldDef, StoryboardTableRow, StoryboardRoleAsset } from '../../types';
import { shotFieldsShallowEqual } from '../../services/storyboardTableParse';
import { storyboardRowCompositeBodyText } from './storyboardRowDisplay';
import StoryboardFrameCompositeCard from './StoryboardFrameCompositeCard';

type Props = {
  row: StoryboardTableRow;
  index: number;
  fieldCatalog: StoryboardParseFieldDef[];
  active: boolean;
  compact?: boolean;
  includeShotText?: boolean;
  overlayRoleMarks?: boolean;
  roleAssets?: StoryboardRoleAsset[];
  onSelect: () => void;
  onPreviewImage: (src: string) => void;
};

function fieldCatalogSignature(catalog: StoryboardParseFieldDef[]): string {
  return catalog.map((f) => `${f.id}:${f.label}:${f.order}`).join('|');
}

function StoryboardConnectedCompositeCardInner({
  row,
  index,
  fieldCatalog,
  active,
  compact = false,
  includeShotText = false,
  overlayRoleMarks = false,
  roleAssets,
  onSelect,
  onPreviewImage,
}: Props) {
  const bodyText = storyboardRowCompositeBodyText(row, fieldCatalog);

  return (
    <StoryboardFrameCompositeCard
      row={row}
      index={index}
      bodyText={bodyText}
      fieldCatalog={fieldCatalog}
      active={active}
      compact={compact}
      includeShotText={includeShotText}
      overlayRoleMarks={overlayRoleMarks}
      roleAssets={roleAssets}
      onSelect={onSelect}
      onPreviewImage={onPreviewImage}
    />
  );
}

function compositePropsEqual(prev: Props, next: Props): boolean {
  if (
    prev.index !== next.index ||
    prev.active !== next.active ||
    prev.compact !== next.compact ||
    prev.includeShotText !== next.includeShotText ||
    prev.overlayRoleMarks !== next.overlayRoleMarks
  ) {
    return false;
  }
  if (fieldCatalogSignature(prev.fieldCatalog) !== fieldCatalogSignature(next.fieldCatalog)) {
    return false;
  }
  const a = prev.row;
  const b = next.row;
  return (
    a.id === b.id &&
    a.shotNo === b.shotNo &&
    a.durationSec === b.durationSec &&
    a.shotRaw === b.shotRaw &&
    shotFieldsShallowEqual(a.shotFields, b.shotFields) &&
    a.shotText === b.shotText &&
    a.frameImage === b.frameImage &&
    a.frameImageObjectKey === b.frameImageObjectKey &&
    a.frameImageCompanionKey === b.frameImageCompanionKey &&
    a.locked === b.locked &&
    a.frameRoleMarks === b.frameRoleMarks
  );
}

const StoryboardConnectedCompositeCard = memo(
  StoryboardConnectedCompositeCardInner,
  compositePropsEqual
);
export default StoryboardConnectedCompositeCard;
