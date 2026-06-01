import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react';
import type { CustomAppModule, StoryboardParseFieldDef, StoryboardRoleAsset, StoryboardTableRow } from '../../types';
import { computeStoryboardInputCoverage } from '../../services/storyboardTableInput';
import type { CapabilityExecuteContext } from '../../services/capabilityExecutor';
import { storyboardInputRowDomId } from './storyboardTableDom';
import StoryboardTableBulkInput from './StoryboardTableBulkInput';
import StoryboardTableSheetGen from './StoryboardTableSheetGen';
import { StoryboardInputCompositePreview } from './StoryboardSheetDomPreview';
import type { StoryboardSheetGenBatchRequest } from '../../services/storyboardTableSheetGen';
import type { StoryboardSheetPreviewItem } from '../../services/storyboardSheetPreview';
import {
  STORYBOARD_INPUT_COLUMN_SHELL,
  STORYBOARD_INPUT_PREVIEW_RAIL,
  STORYBOARD_INPUT_VIEW_GRID,
  STORYBOARD_PAD_PANEL,
  STORYBOARD_STAT_CHIP,
} from './storyboardTableUi';

export type StoryboardTableInputViewHandle = {
  scrollToRow: (rowId: string) => void;
};

type Props = {
  assetId: string;
  rows: StoryboardTableRow[];
  fieldCatalog: StoryboardParseFieldDef[];
  roleAssets: StoryboardRoleAsset[];
  roleAssetBusyId?: string | null;
  parsePreset?: CustomAppModule | null;
  parseCtx?: CapabilityExecuteContext;
  activeRowId: string | null;
  readOnly?: boolean;
  onActiveRowIdChange: (rowId: string) => void;
  onImportRows: (result: {
    catalog: StoryboardParseFieldDef[];
    rows: StoryboardTableRow[];
  }) => void;
  redrawPresets: CustomAppModule[];
  redrawPresetId: string;
  sheetGenBusy?: boolean;
  sheetGenProgress?: { done: number; total: number } | null;
  dropdownZIndex?: { backdrop: number; list: number };
  onRedrawPresetChange: (presetId: string) => void;
  onSheetGenRun: (request: StoryboardSheetGenBatchRequest) => Promise<void>;
  sheetPreviews?: StoryboardSheetPreviewItem[];
  sheetSplitBusyId?: string | null;
  onPreviewSheetImage?: (src: string) => void;
  onUploadSheetPreview?: (dataUrl: string) => void;
  onApplySheetPreview?: (previewId: string) => Promise<void>;
  onNotify?: (level: 'info' | 'warn' | 'error', message: string) => void;
  onOpenEdit: () => void;
  onAddRoleAsset: () => void;
  onRemoveRoleAsset: (id: string) => void;
  onRenameRoleAsset: (id: string, name: string) => void;
  onAssignRoleAssetImage: (id: string, file: File) => void;
  onClearRoleAssetImage: (id: string) => void;
  onPreviewRoleAssetImage?: (src: string) => void;
};

const StoryboardTableInputView = forwardRef<StoryboardTableInputViewHandle, Props>(
  function StoryboardTableInputView(
    {
      assetId,
      rows,
      fieldCatalog,
      roleAssets,
      roleAssetBusyId = null,
      parsePreset,
      parseCtx,
      activeRowId,
      readOnly = false,
      onActiveRowIdChange,
      onImportRows,
      redrawPresets,
      redrawPresetId,
      sheetGenBusy = false,
      sheetGenProgress = null,
      dropdownZIndex,
      onRedrawPresetChange,
      onSheetGenRun,
      sheetPreviews = [],
      sheetSplitBusyId = null,
      onPreviewSheetImage,
      onUploadSheetPreview,
      onApplySheetPreview,
      onNotify,
      onOpenEdit,
      onAddRoleAsset,
      onRemoveRoleAsset,
      onRenameRoleAsset,
      onAssignRoleAssetImage,
      onClearRoleAssetImage,
      onPreviewRoleAssetImage,
    },
    ref
  ) {
    const [draftTick, setDraftTick] = useState(0);

    const coverage = useMemo(
      () => computeStoryboardInputCoverage(rows, fieldCatalog),
      [fieldCatalog, rows]
    );

    const scrollToRow = useCallback((rowId: string) => {
      const el = document.getElementById(storyboardInputRowDomId(rowId));
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, []);

    useImperativeHandle(ref, () => ({ scrollToRow }), [scrollToRow]);

    return (
      <div className={`${STORYBOARD_INPUT_VIEW_GRID} ${STORYBOARD_PAD_PANEL} pt-1`}>
        <section className={STORYBOARD_INPUT_COLUMN_SHELL}>
          <StoryboardTableBulkInput
            assetId={assetId}
            rows={rows}
            fieldCatalog={fieldCatalog}
            roleAssets={roleAssets}
            roleAssetBusyId={roleAssetBusyId}
            parsePreset={parsePreset}
            parseCtx={parseCtx}
            readOnly={readOnly}
            onImport={onImportRows}
            onDraftChange={() => setDraftTick((tick) => tick + 1)}
            onNotify={onNotify}
            onAddRoleAsset={onAddRoleAsset}
            onRemoveRoleAsset={onRemoveRoleAsset}
            onRenameRoleAsset={onRenameRoleAsset}
            onAssignRoleAssetImage={onAssignRoleAssetImage}
            onClearRoleAssetImage={onClearRoleAssetImage}
            onPreviewRoleAssetImage={onPreviewRoleAssetImage}
          />
        </section>

        <section className={STORYBOARD_INPUT_COLUMN_SHELL}>
          <StoryboardTableSheetGen
            assetId={assetId}
            draftTick={draftTick}
            sheetPreviews={sheetPreviews}
            sheetSplitBusyId={sheetSplitBusyId}
            onPreviewImage={onPreviewSheetImage}
            onUploadSheet={onUploadSheetPreview}
            onApplySheet={onApplySheetPreview}
            rows={rows}
            fieldCatalog={fieldCatalog}
            redrawPresets={redrawPresets}
            effectiveRedrawPresetId={redrawPresetId}
            readOnly={readOnly}
            busy={sheetGenBusy}
            progress={sheetGenProgress}
            dropdownZIndex={dropdownZIndex}
            onPresetChange={onRedrawPresetChange}
            onRun={onSheetGenRun}
            onNotify={onNotify}
          />
        </section>

        <section className={`${STORYBOARD_INPUT_PREVIEW_RAIL} rounded-2xl border border-white/[0.08] bg-white/[0.05]`}>
          <div className="flex shrink-0 flex-col gap-1 border-b border-white/[0.06] px-2.5 py-2">
            <div className="flex items-center gap-1.5">
              <h2 className="text-[10px] font-semibold text-gray-200">解析预览</h2>
              <button
                type="button"
                onClick={onOpenEdit}
                className="ml-auto text-[9px] font-semibold text-gray-300 transition-colors hover:text-white"
              >
                编辑 →
              </button>
            </div>
            <div className="flex flex-wrap gap-1">
              <span className={STORYBOARD_STAT_CHIP}>
                解析 {coverage.parsed}/{coverage.total}
              </span>
              <span className={STORYBOARD_STAT_CHIP}>图 {coverage.withImage}</span>
            </div>
          </div>
          <StoryboardInputCompositePreview
            rows={rows}
            fieldCatalog={fieldCatalog}
            activeRowId={activeRowId}
            onSelectRow={onActiveRowIdChange}
            onPreviewImage={onPreviewSheetImage}
          />
        </section>
      </div>
    );
  }
);

export default StoryboardTableInputView;
