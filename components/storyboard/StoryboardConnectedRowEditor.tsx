import React, { memo } from 'react';
import type { StoryboardTableRow } from '../../types';
import { useStoryboardRowInteraction } from './StoryboardRowInteractionContext';
import StoryboardTableRowEditor from './StoryboardTableRowEditor';

type Props = {
  row: StoryboardTableRow;
  index: number;
  domId?: string;
  active: boolean;
  imageBusy: boolean;
  redrawBusy: boolean;
  redrawDisabled: boolean;
  redrawDisabledReason?: string;
};

function StoryboardConnectedRowEditorInner({
  row,
  index,
  domId,
  active,
  imageBusy,
  redrawBusy,
  redrawDisabled,
  redrawDisabledReason,
}: Props) {
  const ctx = useStoryboardRowInteraction();

  return (
    <StoryboardTableRowEditor
      domId={domId}
      row={row}
      index={index}
      rowCount={ctx.rowCount}
      active={active}
      readOnly={ctx.readOnly}
      imageBusy={imageBusy}
      onFocusRow={() => ctx.focusRow(row.id)}
      onPatch={(patch) => ctx.patchRow(row.id, patch)}
      onMove={(dir) => ctx.moveRow(row.id, dir)}
      onRemove={() => ctx.removeRow(row.id)}
      onPickImage={() => ctx.openFileForRow(row.id)}
      onClearImage={() => ctx.clearRowImage(row.id)}
      onPreviewImage={ctx.previewImage}
      onImageDrop={(e) => ctx.assignFrameImageFromDrop(row.id, e)}
      onImagePaste={(e) => ctx.assignFrameImageFromPaste(row.id, e)}
      redrawBusy={redrawBusy}
      redrawDisabled={redrawDisabled}
      redrawDisabledReason={redrawDisabledReason}
      onRedraw={
        ctx.hasRedrawHandler && !ctx.readOnly ? () => void ctx.runRedraw(row.id) : undefined
      }
      timelineLayerCount={ctx.timelineLayerCount}
    />
  );
}

function rowEditorPropsEqual(prev: Props, next: Props): boolean {
  if (
    prev.index !== next.index ||
    prev.domId !== next.domId ||
    prev.active !== next.active ||
    prev.imageBusy !== next.imageBusy ||
    prev.redrawBusy !== next.redrawBusy ||
    prev.redrawDisabled !== next.redrawDisabled ||
    prev.redrawDisabledReason !== next.redrawDisabledReason
  ) {
    return false;
  }
  const a = prev.row;
  const b = next.row;
  return (
    a.id === b.id &&
    a.index === b.index &&
    a.shotNo === b.shotNo &&
    a.durationSec === b.durationSec &&
    a.shotText === b.shotText &&
    a.frameImage === b.frameImage &&
    a.frameImageObjectKey === b.frameImageObjectKey &&
    a.frameImageCompanionKey === b.frameImageCompanionKey &&
    a.locked === b.locked &&
    (a.timelineLayer ?? 0) === (b.timelineLayer ?? 0)
  );
}

const StoryboardConnectedRowEditor = memo(StoryboardConnectedRowEditorInner, rowEditorPropsEqual);
export default StoryboardConnectedRowEditor;
