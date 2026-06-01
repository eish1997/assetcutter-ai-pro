import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react';
import type { CustomAppModule, StoryboardParseFieldDef, StoryboardTableRow } from '../../types';
import {
  readLocalJson,
  scopedStorageKey,
  writeLocalJson,
} from '../../services/clientPersist';
import type { StoryboardSheetGenBatchRequest } from '../../services/storyboardTableSheetGen';
import type { StoryboardBulkTextMode } from '../../services/storyboardTableBulkImport';
import {
  defaultStoryboardBulkDraft,
  storyboardBulkDraftStorageKey,
} from '../../services/storyboardTableInput';
import {
  buildStoryboardSheetGenBatchPreviews,
  normalizeShotsPerSheet,
  planStoryboardSheetGenTasks,
  probeStoryboardSheetGenCompanionReady,
  resolveSheetGenSourceRows,
  sheetGenTaskCount,
  storyboardSheetGenCompanionProbeMessage,
  STORYBOARD_SHEET_SHOTS_PER_IMAGE_KEY,
  STORYBOARD_SHEET_SHOTS_PER_IMAGE_OPTIONS,
} from '../../services/storyboardTableSheetGen';
import StoryboardSheetGenConfirmModal from './StoryboardSheetGenConfirmModal';
import StoryboardCompanionRequiredModal from './StoryboardCompanionRequiredModal';

function sheetShotsStorageKey(assetId: string): string {
  return scopedStorageKey(`${STORYBOARD_SHEET_SHOTS_PER_IMAGE_KEY}__${assetId}`, null);
}

export type StoryboardTableSheetGenHandle = {
  generateAndSplit: () => void;
};

type Props = {
  assetId: string;
  draftTick?: number;
  rows: StoryboardTableRow[];
  fieldCatalog: StoryboardParseFieldDef[];
  redrawPresets: CustomAppModule[];
  effectiveRedrawPresetId: string;
  readOnly?: boolean;
  busy?: boolean;
  companionBaseUrl?: string;
  companionProjectId?: string;
  onPresetChange: (presetId: string) => void;
  onRun: (request: StoryboardSheetGenBatchRequest) => Promise<void>;
  onNotify?: (level: 'info' | 'warn' | 'error', message: string) => void;
};

function readBulkDraft(assetId: string) {
  return readLocalJson(storyboardBulkDraftStorageKey(assetId), defaultStoryboardBulkDraft());
}

const StoryboardTableSheetGen = forwardRef<StoryboardTableSheetGenHandle, Props>(
  function StoryboardTableSheetGen(
    {
      assetId,
      draftTick = 0,
      rows,
      fieldCatalog,
      redrawPresets,
      effectiveRedrawPresetId,
      readOnly = false,
      busy = false,
      companionBaseUrl = '',
      companionProjectId = '',
      onPresetChange,
      onRun,
      onNotify,
    },
    ref
  ) {
    const [shotsPerSheet, setShotsPerSheet] = useState(25);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [companionGateOpen, setCompanionGateOpen] = useState(false);
    const [companionGateMessage, setCompanionGateMessage] = useState('');
    const bulkDraft = useMemo(() => readBulkDraft(assetId), [assetId, draftTick]);

    useEffect(() => {
      setShotsPerSheet(
        normalizeShotsPerSheet(readLocalJson(sheetShotsStorageKey(assetId), 25, (v) => v))
      );
    }, [assetId]);

    const bulkText = bulkDraft.pipeText;
    const bulkMode: StoryboardBulkTextMode = 'pipe';

    const source = useMemo(
      () => resolveSheetGenSourceRows(rows, bulkText, bulkMode, fieldCatalog),
      [bulkMode, bulkText, fieldCatalog, rows]
    );

    const tasks = useMemo(
      () => planStoryboardSheetGenTasks(source.rows, shotsPerSheet),
      [shotsPerSheet, source.rows]
    );

    const activePreset = useMemo(
      () => redrawPresets.find((item) => item.id === effectiveRedrawPresetId) ?? null,
      [effectiveRedrawPresetId, redrawPresets]
    );

    const batchPreviews = useMemo(() => {
      if (!activePreset || !tasks.length) return [];
      return buildStoryboardSheetGenBatchPreviews({
        tasks,
        fieldCatalog: source.catalog,
        promptExtra: '',
        preset: activePreset,
      });
    }, [activePreset, source.catalog, tasks]);

    const presetOptions = useMemo(
      () => redrawPresets.map((preset) => ({ value: preset.id, label: preset.label || preset.id })),
      [redrawPresets]
    );

    const shotsOptions = useMemo(
      () =>
        STORYBOARD_SHEET_SHOTS_PER_IMAGE_OPTIONS.map((value) => ({
          value: String(value),
          label: `每图 ${value} 镜`,
        })),
      []
    );

    const handleShotsChange = (value: string) => {
      const next = normalizeShotsPerSheet(value);
      setShotsPerSheet(next);
      writeLocalJson(sheetShotsStorageKey(assetId), next);
    };

    const handlePresetChange = (value: string) => {
      onPresetChange(value);
    };

    const ensureCompanionReady = useCallback(async (): Promise<boolean> => {
      const probe = await probeStoryboardSheetGenCompanionReady(companionBaseUrl, companionProjectId);
      if (probe.ok) return true;
      setCompanionGateMessage(storyboardSheetGenCompanionProbeMessage(probe.reason));
      setCompanionGateOpen(true);
      return false;
    }, [companionBaseUrl, companionProjectId]);

    const generateAndSplit = useCallback(() => {
      if (readOnly || busy) return;
      if (!redrawPresets.length) {
        onNotify?.('warn', '请先在功能区启用文生图/图生图能力');
        return;
      }
      if (!source.rows.length) {
        onNotify?.('warn', '请先识别解析并填充镜头，或输入可生成提示词的文本');
        return;
      }
      if (!tasks.length) {
        onNotify?.('warn', '没有可执行的生成任务');
        return;
      }
      void (async () => {
        if (!(await ensureCompanionReady())) return;
        setConfirmOpen(true);
      })();
    }, [
      busy,
      ensureCompanionReady,
      onNotify,
      readOnly,
      redrawPresets.length,
      source.rows.length,
      tasks.length,
    ]);

    useImperativeHandle(ref, () => ({ generateAndSplit }), [generateAndSplit]);

    const handleConfirmRun = useCallback(
      async (selectedChunkIndexes: number[]) => {
        if (readOnly || busy || !activePreset) {
          if (!activePreset) {
            onNotify?.('warn', '请选择生图能力');
          }
          return;
        }
        if (!selectedChunkIndexes.length) {
          onNotify?.('warn', '请至少选择一个批次');
          return;
        }
        if (!(await ensureCompanionReady())) return;
        setConfirmOpen(false);
        await onRun({
          presetId: effectiveRedrawPresetId,
          shotsPerSheet,
          promptExtra: '',
          forceTextToImage: activePreset.category === 'image_to_image',
          sourceRows: source.rows,
          fieldCatalog: source.catalog,
          selectedChunkIndexes,
        });
      },
      [
        activePreset,
        busy,
        effectiveRedrawPresetId,
        ensureCompanionReady,
        onNotify,
        onRun,
        readOnly,
        shotsPerSheet,
        source.catalog,
        source.rows,
      ]
    );

    const taskTotal = sheetGenTaskCount(source.rows.length, shotsPerSheet);

    return (
      <>
        <StoryboardCompanionRequiredModal
          open={companionGateOpen}
          message={companionGateMessage}
          onClose={() => setCompanionGateOpen(false)}
        />
        <StoryboardSheetGenConfirmModal
          open={confirmOpen}
          busy={busy}
          readOnly={readOnly}
          presetLabel={activePreset?.label || activePreset?.id || ''}
          presetInstruction={activePreset?.instruction || ''}
          directSend={activePreset?.skipUnderstand === true}
          shotsPerSheet={shotsPerSheet}
          shotsOptions={shotsOptions}
          onShotsPerSheetChange={handleShotsChange}
          presetId={effectiveRedrawPresetId}
          presetOptions={presetOptions}
          onPresetChange={handlePresetChange}
          shotCount={source.rows.length}
          taskCount={tasks.length || taskTotal}
          batches={batchPreviews}
          onClose={() => setConfirmOpen(false)}
          onConfirm={(selectedChunkIndexes) => void handleConfirmRun(selectedChunkIndexes)}
        />
      </>
    );
  }
);

export default StoryboardTableSheetGen;
