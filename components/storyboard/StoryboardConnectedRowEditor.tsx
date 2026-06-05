import React, { memo } from 'react';
import type { StoryboardParseFieldDef, StoryboardTableRow } from '../../types';
import { shotFieldsShallowEqual, rowHasStructuredFieldValues } from '../../services/storyboardTableParse';
import { storyboardFrameHistorySignature } from '../../services/storyboardFrameHistory';
import { useStoryboardRowInteraction } from './StoryboardRowInteractionContext';
import StoryboardTableRowEditor from './StoryboardTableRowEditor';

type Props = {
  row: StoryboardTableRow;
  index: number;
  fieldCatalog: StoryboardParseFieldDef[];
  domId?: string;
  active: boolean;
  imageBusy: boolean;
  redrawBusy: boolean;
  parseBusy: boolean;
  optimizeBusy?: boolean;
  redrawDisabled: boolean;
  redrawDisabledReason?: string;
  editDisplayMode?: 'full' | 'feedback';
};

function fieldCatalogSignature(catalog: StoryboardParseFieldDef[]): string {
  return catalog.map((f) => `${f.id}:${f.label}:${f.order}`).join('|');
}

function StoryboardConnectedRowEditorInner({
  row,
  index,
  fieldCatalog,
  domId,
  active,
  imageBusy,
  redrawBusy,
  parseBusy,
  optimizeBusy = false,
  redrawDisabled,
  redrawDisabledReason,
  editDisplayMode = 'full',
}: Props) {
  const ctx = useStoryboardRowInteraction();
  const optimizeDisabledReason = !fieldCatalog.length
    ? '请先解析出结构化字段'
    : !rowHasStructuredFieldValues(fieldCatalog, row)
      ? '请先填写结构化字段'
      : undefined;

  return (
    <StoryboardTableRowEditor
      domId={domId}
      row={row}
      index={index}
      rowCount={ctx.rowCount}
      fieldCatalog={fieldCatalog}
      active={active}
      readOnly={ctx.readOnly}
      imageBusy={imageBusy}
      onFocusRow={() => ctx.focusRow(row.id)}
      onPatch={(patch) => ctx.patchRow(row.id, patch)}
      onCommitShotNo={!ctx.readOnly ? (raw) => ctx.commitRowShotNo(row.id, raw) : undefined}
      onMove={(dir) => ctx.moveRow(row.id, dir)}
      onRemove={() => ctx.removeRow(row.id)}
      onPickImage={() => ctx.openFileForRow(row.id)}
      onClearImage={() => ctx.clearRowImage(row.id)}
      onPreviewImage={() => ctx.previewRowFrame(row)}
      onImageDrop={(e) => ctx.assignFrameImageFromDrop(row.id, e)}
      onImagePaste={(e) => ctx.assignFrameImageFromPaste(row.id, e)}
      parseBusy={parseBusy}
      optimizeBusy={optimizeBusy}
      onParseRow={
        ctx.hasParseHandler && !ctx.readOnly ? () => void ctx.runParse(row.id) : undefined
      }
      onOptimizeRow={
        ctx.hasOptimizeHandler && !ctx.readOnly ? () => void ctx.runOptimize(row.id) : undefined
      }
      optimizeDisabledReason={optimizeDisabledReason}
      redrawBusy={redrawBusy}
      redrawDisabled={redrawDisabled}
      redrawDisabledReason={redrawDisabledReason}
      onRedraw={
        ctx.hasRedrawHandler && !ctx.readOnly ? () => void ctx.runRedraw(row.id) : undefined
      }
      onRestoreFrameVersion={
        !ctx.readOnly ? (versionId) => ctx.restoreFrameVersion(row.id, versionId) : undefined
      }
      timelineLayerCount={ctx.timelineLayerCount}
      editDisplayMode={editDisplayMode}
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
    prev.parseBusy !== next.parseBusy ||
    prev.optimizeBusy !== next.optimizeBusy ||
    prev.redrawDisabled !== next.redrawDisabled ||
    prev.redrawDisabledReason !== next.redrawDisabledReason ||
    prev.editDisplayMode !== next.editDisplayMode
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
    a.index === b.index &&
    a.shotNo === b.shotNo &&
    a.durationSec === b.durationSec &&
    a.shotRaw === b.shotRaw &&
    shotFieldsShallowEqual(a.shotFields, b.shotFields) &&
    a.shotText === b.shotText &&
    a.frameImage === b.frameImage &&
    a.frameImageObjectKey === b.frameImageObjectKey &&
    a.frameImageCompanionKey === b.frameImageCompanionKey &&
    storyboardFrameHistorySignature(a.frameImageHistory) ===
      storyboardFrameHistorySignature(b.frameImageHistory) &&
    a.locked === b.locked &&
    (a.timelineLayer ?? 0) === (b.timelineLayer ?? 0) &&
    (a.editFeedback ?? '') === (b.editFeedback ?? '') &&
    a.frameRoleMarks === b.frameRoleMarks
  );
}

const StoryboardConnectedRowEditor = memo(StoryboardConnectedRowEditorInner, rowEditorPropsEqual);
export default StoryboardConnectedRowEditor;
