import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react';
import type { CustomAppModule, StoryboardParseFieldDef, StoryboardTableRow } from '../../types';
import {
  computeStoryboardInputCoverage,
  storyboardInputPreviewFieldLines,
} from '../../services/storyboardTableInput';
import { rowHasStructuredFieldValues } from '../../services/storyboardTableParse';
import { storyboardRowHasFrameRef } from '../../services/storyboardFrameImageUrl';
import { storyboardRowOutlineTitle } from './storyboardRowDisplay';
import { storyboardInputRowDomId } from './storyboardTableDom';
import StoryboardTableBulkInput from './StoryboardTableBulkInput';
import StoryboardTableSheetGen from './StoryboardTableSheetGen';
import type { StoryboardSheetGenBatchRequest } from '../../services/storyboardTableSheetGen';
import type { StoryboardSheetPreviewItem } from '../../services/storyboardSheetPreview';
import {
  STORYBOARD_BODY_SCROLL,
  STORYBOARD_GAP_STACK,
  STORYBOARD_INPUT_COLUMN_SHELL,
  STORYBOARD_INPUT_PREVIEW_RAIL,
  STORYBOARD_INPUT_VIEW_GRID,
  STORYBOARD_PAD_PANEL,
  STORYBOARD_ROW_ACTIVE,
  STORYBOARD_ROW_IDLE,
  STORYBOARD_STAT_CHIP,
} from './storyboardTableUi';

export type StoryboardTableInputViewHandle = {
  scrollToRow: (rowId: string) => void;
};

type Props = {
  assetId: string;
  rows: StoryboardTableRow[];
  fieldCatalog: StoryboardParseFieldDef[];
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
};

const StoryboardTableInputView = forwardRef<StoryboardTableInputViewHandle, Props>(
  function StoryboardTableInputView(
    {
      assetId,
      rows,
      fieldCatalog,
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
            readOnly={readOnly}
            onImport={onImportRows}
            onDraftChange={() => setDraftTick((tick) => tick + 1)}
            onNotify={onNotify}
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

        <section className={`${STORYBOARD_INPUT_PREVIEW_RAIL} rounded-2xl border border-white/[0.08] bg-black/20`}>
          <div className="flex shrink-0 flex-col gap-1 border-b border-white/[0.06] px-2.5 py-2">
            <div className="flex items-center gap-1.5">
              <h2 className="text-[10px] font-semibold text-gray-200">解析预览</h2>
              <button
                type="button"
                onClick={onOpenEdit}
                className="ml-auto text-[9px] font-semibold text-violet-300/90 transition-colors hover:text-violet-200"
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
          <div className={`${STORYBOARD_BODY_SCROLL} flex-1 px-1.5 py-1.5`}>
            {rows.length === 0 ? (
              <p className="py-8 text-center text-[11px] text-gray-600">导入后将在此展示结构化字段</p>
            ) : (
              <div className={`flex flex-col ${STORYBOARD_GAP_STACK}`}>
                {rows.map((row) => {
                  const active = row.id === activeRowId;
                  const title = storyboardRowOutlineTitle(row, row.index);
                  const parsed = rowHasStructuredFieldValues(fieldCatalog, row);
                  const lines = storyboardInputPreviewFieldLines(row, fieldCatalog, 2);
                  const hasImage = storyboardRowHasFrameRef(row);
                  return (
                    <button
                      key={row.id}
                      id={storyboardInputRowDomId(row.id)}
                      type="button"
                      onClick={() => onActiveRowIdChange(row.id)}
                      className={`w-full rounded-xl border px-2 py-1.5 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 ${
                        active ? STORYBOARD_ROW_ACTIVE : STORYBOARD_ROW_IDLE
                      }`}
                    >
                      <div className="mb-1 flex flex-wrap items-center gap-1">
                        <span className="text-[10px] font-bold text-white/95">{title}</span>
                        {parsed ? (
                          <span className="rounded bg-violet-500/20 px-1 py-px text-[7px] text-violet-100">
                            析
                          </span>
                        ) : (
                          <span className="rounded bg-white/[0.06] px-1 py-px text-[7px] text-gray-500">
                            待
                          </span>
                        )}
                        {hasImage ? (
                          <span className="rounded bg-white/[0.06] px-1 py-px text-[7px] text-gray-400">
                            图
                          </span>
                        ) : null}
                      </div>
                      {lines.length ? (
                        <div className="space-y-0.5">
                          {lines.map((line) => (
                            <p
                              key={`${row.id}-${line.label}`}
                              className="line-clamp-2 text-[9px] leading-snug text-gray-300"
                            >
                              <span className="text-gray-500">{line.label}：</span>
                              <span className="break-words">{line.value}</span>
                            </p>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[9px] text-gray-600">（待解析）</p>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>
    );
  }
);

export default StoryboardTableInputView;
