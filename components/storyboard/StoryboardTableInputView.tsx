import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { CustomAppModule, StoryboardParseFieldDef, StoryboardRoleAsset, StoryboardTableRow } from '../../types';
import type { CapabilityExecuteContext } from '../../services/capabilityExecutor';
import { storyboardInputRowDomId } from './storyboardTableDom';
import StoryboardTableBulkInput, {
  type StoryboardTableBulkInputHandle,
} from './StoryboardTableBulkInput';
import StoryboardTableSheetGen, {
  type StoryboardTableSheetGenHandle,
} from './StoryboardTableSheetGen';
import StoryboardRoleAssetStrip from './StoryboardRoleAssetStrip';
import StoryboardSheetPreviewStrip from './StoryboardSheetPreviewStrip';
import StoryboardSheetUploadModal from './StoryboardSheetUploadModal';
import { readStoryboardFrameFromFile } from './storyboardFrameImage';
import type { StoryboardSheetPreviewItem } from '../../services/storyboardSheetPreview';
import {
  STORYBOARD_INPUT_MAIN,
  STORYBOARD_INPUT_MAIN_INNER,
  STORYBOARD_INPUT_VIEW_GRID,
  STORYBOARD_PAD_PANEL,
  STORYBOARD_TOOL_BTN_NEUTRAL,
  STORYBOARD_TOOL_BTN_PRIMARY,
} from './storyboardTableUi';

export type StoryboardTableInputViewHandle = {
  scrollToRow: (rowId: string) => void;
};

type InputCompletionGuide =
  | { kind: 'parse'; rowCount: number; appended: boolean }
  | { kind: 'split'; rowCount: number };

type SplitSheetPreviewResult = { matchedCount: number } | void;

type Props = {
  assetId: string;
  rows: StoryboardTableRow[];
  fieldCatalog: StoryboardParseFieldDef[];
  roleAssets: StoryboardRoleAsset[];
  roleAssetBusyId?: string | null;
  parsePreset?: CustomAppModule | null;
  parseCtx?: CapabilityExecuteContext;
  readOnly?: boolean;
  onImportRows: (result: {
    catalog: StoryboardParseFieldDef[];
    rows: StoryboardTableRow[];
  }) => void;
  redrawPresets: CustomAppModule[];
  redrawPresetId: string;
  sheetGenBusy?: boolean;
  sheetGenProgress?: { done: number; total: number } | null;
  onRedrawPresetChange: (presetId: string) => void;
  onSheetGenRun: (request: StoryboardSheetGenBatchRequest) => Promise<void>;
  companionBaseUrl?: string;
  companionProjectId?: string;
  sheetPreviews?: StoryboardSheetPreviewItem[];
  sheetSplitBusyId?: string | null;
  sheetRegenBusyId?: string | null;
  sheetSplitBatchBusy?: boolean;
  sheetSplitProgress?: { done: number; total: number } | null;
  splittableSheetCount?: number;
  onPreviewSheetImage?: (preview: StoryboardSheetPreviewItem) => void;
  onUploadSheetPreview?: (
    dataUrl: string,
    range: { shotFrom: string; shotTo: string }
  ) => void | Promise<void>;
  onUpdateSheetPreviewShotRange?: (
    previewId: string,
    range: { shotFrom: string; shotTo: string }
  ) => void | Promise<void>;
  onApplySheetPreview?: (previewId: string) => Promise<SplitSheetPreviewResult>;
  onRegenerateSheetPreview?: (previewId: string) => Promise<void>;
  onActivateSheetPreviewVersion?: (previewId: string, versionId: string) => Promise<void>;
  onBatchSplitSheetPreviews?: () => Promise<SplitSheetPreviewResult>;
  onDeleteSheetPreview?: (previewId: string) => void;
  onCancelSheetGen?: () => void;
  onCancelSheetGenTask?: (previewId: string) => void;
  onGoToEdit?: () => void;
  onNotify?: (level: 'info' | 'warn' | 'error', message: string) => void;
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
      readOnly = false,
      onImportRows,
      redrawPresets,
      redrawPresetId,
      sheetGenBusy = false,
      sheetGenProgress = null,
      onRedrawPresetChange,
      onSheetGenRun,
      companionBaseUrl = '',
      companionProjectId = '',
      sheetPreviews = [],
      sheetSplitBusyId = null,
      sheetRegenBusyId = null,
      sheetSplitBatchBusy = false,
      sheetSplitProgress = null,
      splittableSheetCount = 0,
      onPreviewSheetImage,
      onUploadSheetPreview,
      onUpdateSheetPreviewShotRange,
      onApplySheetPreview,
      onRegenerateSheetPreview,
      onActivateSheetPreviewVersion,
      onBatchSplitSheetPreviews,
      onDeleteSheetPreview,
      onCancelSheetGen,
      onCancelSheetGenTask,
      onGoToEdit,
      onNotify,
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
    const [parseBusy, setParseBusy] = useState(false);
    const [completionGuide, setCompletionGuide] = useState<InputCompletionGuide | null>(null);
    const [uploadDraft, setUploadDraft] = useState<{ dataUrl: string } | null>(null);
    const [editPreviewId, setEditPreviewId] = useState<string | null>(null);
    const bulkInputRef = useRef<StoryboardTableBulkInputHandle>(null);
    const sheetGenRef = useRef<StoryboardTableSheetGenHandle>(null);

    const scrollToRow = useCallback((rowId: string) => {
      const el = document.getElementById(storyboardInputRowDomId(rowId));
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, []);

    useImperativeHandle(ref, () => ({ scrollToRow }), [scrollToRow]);

    const actionBusy = parseBusy || sheetGenBusy || sheetSplitBatchBusy;
    const stripBusy = sheetGenBusy || sheetSplitBatchBusy;
    const stripProgress = sheetSplitBatchBusy ? sheetSplitProgress : sheetGenProgress;

    const defaultShotFrom = useMemo(() => {
      const unlocked = rows.filter((row) => !row.locked);
      const first = unlocked.find((row) => row.shotNo?.trim()) ?? unlocked[0];
      return first?.shotNo?.trim() || '01';
    }, [rows]);

    const defaultShotTo = useMemo(() => {
      const unlocked = rows.filter((row) => !row.locked);
      const last = [...unlocked].reverse().find((row) => row.shotNo?.trim()) ?? unlocked[unlocked.length - 1];
      return last?.shotNo?.trim() || defaultShotFrom;
    }, [defaultShotFrom, rows]);

    const editingPreview = useMemo(
      () => sheetPreviews.find((preview) => preview.id === editPreviewId) ?? null,
      [editPreviewId, sheetPreviews]
    );

    const modalDefaultFrom = editingPreview?.shotNos[0] ?? defaultShotFrom;
    const modalDefaultTo =
      editingPreview?.shotNos[editingPreview.shotNos.length - 1] ?? defaultShotTo;
    const modalPreviewSrc = uploadDraft?.dataUrl ?? editingPreview?.imageDataUrl ?? null;

    const showSplitGuide = useCallback((result: SplitSheetPreviewResult) => {
      if (result && result.matchedCount > 0) {
        setCompletionGuide({ kind: 'split', rowCount: result.matchedCount });
      }
    }, []);

    const handleBatchSplit = useCallback(async () => {
      setCompletionGuide(null);
      showSplitGuide(await onBatchSplitSheetPreviews?.());
    }, [onBatchSplitSheetPreviews, showSplitGuide]);

    const handleApplySheet = useCallback(
      async (previewId: string) => {
        setCompletionGuide(null);
        showSplitGuide(await onApplySheetPreview?.(previewId));
      },
      [onApplySheetPreview, showSplitGuide]
    );

    const guideMessage =
      completionGuide?.kind === 'split'
        ? `切分完成 · 已回填 ${completionGuide.rowCount} 镜`
        : completionGuide?.kind === 'parse'
          ? `解析完成 · ${completionGuide.appended ? '已合并' : '已写入'} ${completionGuide.rowCount} 镜`
          : '';

    return (
      <div className={`${STORYBOARD_INPUT_VIEW_GRID} ${STORYBOARD_PAD_PANEL} pt-1`}>
        {completionGuide ? (
          <div className="flex shrink-0 justify-center px-1 pt-2 sm:px-2">
            <div className={`${STORYBOARD_INPUT_MAIN_INNER} !gap-0 !py-0`}>
              <div
                className="flex items-center justify-between gap-3 rounded-xl border border-emerald-400/15 bg-emerald-500/[0.08] px-3 py-2"
                role="status"
              >
                <p className="truncate text-[11px] text-emerald-100/90">{guideMessage}</p>
                <div className="flex shrink-0 items-center gap-2">
                  {onGoToEdit ? (
                    <button
                      type="button"
                      onClick={() => {
                        setCompletionGuide(null);
                        onGoToEdit();
                      }}
                      className={`${STORYBOARD_TOOL_BTN_PRIMARY} h-7 px-3 text-[10px]`}
                    >
                      前往编辑
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setCompletionGuide(null)}
                    className="text-[10px] text-emerald-200/70 transition-colors hover:text-emerald-100"
                    aria-label="关闭提示"
                  >
                    关闭
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
        <div className={STORYBOARD_INPUT_MAIN}>
          <div className={STORYBOARD_INPUT_MAIN_INNER}>
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold text-gray-300">角色资产</span>
                <span className="text-[9px] text-gray-500">{roleAssets.length} 个</span>
              </div>
              <StoryboardRoleAssetStrip
                roleAssets={roleAssets}
                readOnly={readOnly}
                busyId={roleAssetBusyId}
                onAdd={onAddRoleAsset}
                onRemove={onRemoveRoleAsset}
                onRename={onRenameRoleAsset}
                onAssignImage={onAssignRoleAssetImage}
                onClearImage={onClearRoleAssetImage}
                onPreviewImage={onPreviewRoleAssetImage}
              />
            </div>

            <StoryboardTableBulkInput
              ref={bulkInputRef}
              assetId={assetId}
              rows={rows}
              fieldCatalog={fieldCatalog}
              parsePreset={parsePreset}
              parseCtx={parseCtx}
              readOnly={readOnly}
              onImport={onImportRows}
              onDraftChange={() => setDraftTick((tick) => tick + 1)}
              onBusyChange={setParseBusy}
              onParseComplete={(detail) =>
                setCompletionGuide({ kind: 'parse', rowCount: detail.rowCount, appended: detail.appended })
              }
              onNotify={onNotify}
            />

            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-center">
              <button
                type="button"
                disabled={readOnly || actionBusy}
                onClick={() => {
                  setCompletionGuide(null);
                  void bulkInputRef.current?.parseAndFill();
                }}
                className={`${STORYBOARD_TOOL_BTN_PRIMARY} h-9 flex-1 px-4 text-[11px] sm:min-w-[6.5rem] sm:max-w-[10rem] sm:flex-none`}
              >
                {parseBusy ? '解析中…' : '解析'}
              </button>
              <button
                type="button"
                disabled={readOnly || actionBusy || !redrawPresets.length}
                onClick={() => sheetGenRef.current?.generateAndSplit()}
                className={`${STORYBOARD_TOOL_BTN_NEUTRAL} h-9 flex-1 px-4 text-[11px] sm:min-w-[6.5rem] sm:max-w-[10rem] sm:flex-none`}
              >
                {sheetGenBusy ? '生成中…' : '生成'}
              </button>
              <button
                type="button"
                disabled={readOnly || actionBusy || splittableSheetCount <= 0}
                onClick={() => void handleBatchSplit()}
                className={`${STORYBOARD_TOOL_BTN_NEUTRAL} h-9 flex-1 px-4 text-[11px] sm:min-w-[6.5rem] sm:max-w-[10rem] sm:flex-none`}
              >
                {sheetSplitBatchBusy
                  ? `切分中 ${sheetSplitProgress?.done ?? 0}/${sheetSplitProgress?.total ?? 0}`
                  : '切分'}
              </button>
            </div>

            <StoryboardSheetPreviewStrip
              sheetPreviews={sheetPreviews}
              sheetSplitBusyId={sheetSplitBusyId}
              sheetRegenBusyId={sheetRegenBusyId}
              busy={stripBusy}
              progress={stripProgress}
              progressLabel={sheetSplitBatchBusy ? '切分中' : '生成中'}
              readOnly={readOnly}
              onPreview={(preview) => onPreviewSheetImage?.(preview)}
              onUpload={
                onUploadSheetPreview
                  ? (file) => {
                      void readStoryboardFrameFromFile(file)
                        .then((dataUrl) => setUploadDraft({ dataUrl }))
                        .catch((error) =>
                          onNotify?.(
                            'warn',
                            error instanceof Error ? error.message : '上传失败'
                          )
                        );
                    }
                  : undefined
              }
              onEditShotRange={
                onUpdateSheetPreviewShotRange ? (previewId) => setEditPreviewId(previewId) : undefined
              }
              onApplySheet={(previewId) => void handleApplySheet(previewId)}
              onRegenerateSheet={(previewId) => void onRegenerateSheetPreview?.(previewId)}
              onSelectSheetVersion={(previewId, versionId) =>
                void onActivateSheetPreviewVersion?.(previewId, versionId)
              }
              onDeleteSheet={onDeleteSheetPreview}
              onCancelGen={onCancelSheetGen}
              onCancelGenTask={onCancelSheetGenTask}
            />

            <StoryboardTableSheetGen
              ref={sheetGenRef}
              assetId={assetId}
              draftTick={draftTick}
              rows={rows}
              fieldCatalog={fieldCatalog}
              redrawPresets={redrawPresets}
              effectiveRedrawPresetId={redrawPresetId}
              readOnly={readOnly}
              busy={sheetGenBusy}
              companionBaseUrl={companionBaseUrl}
              companionProjectId={companionProjectId}
              onPresetChange={onRedrawPresetChange}
              onRun={onSheetGenRun}
              onNotify={onNotify}
            />
          </div>
        </div>

        <StoryboardSheetUploadModal
          open={Boolean(uploadDraft || editingPreview)}
          previewSrc={modalPreviewSrc}
          defaultFrom={modalDefaultFrom}
          defaultTo={modalDefaultTo}
          title={editingPreview ? '修改镜号范围' : '上传拼图'}
          confirmLabel={editingPreview ? '保存' : '加入预览'}
          onClose={() => {
            setUploadDraft(null);
            setEditPreviewId(null);
          }}
          onConfirm={(range) => {
            if (uploadDraft) {
              void Promise.resolve(onUploadSheetPreview?.(uploadDraft.dataUrl, range)).finally(() => {
                setUploadDraft(null);
              });
              return;
            }
            if (editPreviewId) {
              void Promise.resolve(
                onUpdateSheetPreviewShotRange?.(editPreviewId, range)
              ).finally(() => {
                setEditPreviewId(null);
              });
            }
          }}
        />
      </div>
    );
  }
);

export default StoryboardTableInputView;
