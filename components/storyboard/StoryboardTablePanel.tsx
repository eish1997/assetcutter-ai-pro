import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CustomAppModule, StoryboardTableRow, WorkflowAsset } from '../../types';
import {
  applyAutoShotNumbers,
  computeStoryboardTableStats,
  createStoryboardTableRow,
  duplicateStoryboardRow,
  normalizeStoryboardTableDoc,
  readStoryboardTableTitleRaw,
  reindexStoryboardRows,
  resolveStoryboardTableTitle,
} from '../../services/storyboardTableAsset';
import { reorderStoryboardRowsInLayer, collapseStoryboardTimelineTopLayer, clampStoryboardTimelineLayerCount } from '../../services/storyboardVideoTimeline';
import { buildStoryboardRowPromptText } from '../../services/storyboardTableRedraw';
import { readLocalJson, writeLocalJson } from '../../services/clientPersist';
import { readStoryboardFrameFromClipboard, readStoryboardFrameFromFile } from './storyboardFrameImage';
import { persistStoryboardFrameImage } from '../../services/storyboardFrameCompanion';
import { storyboardRowHasFrameRef } from '../../services/storyboardFrameImageUrl';
import { ImagePreviewOverlay } from '../ImagePreviewOverlay';
import AppIcon from '../ui/AppIcon';
import StoryboardTableEditView, {
  type StoryboardTableEditViewHandle,
} from './StoryboardTableEditView';
import type { StoryboardRowInteractionValue } from './StoryboardRowInteractionContext';
import { storyboardCompositeDomId } from './storyboardTableDom';
import StoryboardTableGridPreview from './StoryboardTableGridPreview';
import StoryboardTableVideoPreview from './StoryboardTableVideoPreview';
import {
  canExportStoryboardVideo,
  startStoryboardVideoExportTask,
  useStoryboardVideoExportTask,
} from './useStoryboardVideoExport';
import StoryboardVideoExportProgress from './StoryboardVideoExportProgress';
import {
  STORYBOARD_ADD_ROW_DASHED,
  STORYBOARD_GAP_TIGHT,
  STORYBOARD_PAD_HEADER_INNER,
  STORYBOARD_PAD_PANEL,
  STORYBOARD_PAD_TOOLBAR,
  STORYBOARD_STAT_CHIP,
  STORYBOARD_TOOL_BTN_GHOST,
  STORYBOARD_TOOL_BTN_NEUTRAL,
  STORYBOARD_TOOL_BTN_PRIMARY,
  STORYBOARD_VIEW_TOGGLE,
  STORYBOARD_VIEW_TOGGLE_ACTIVE,
  STORYBOARD_VIEW_TOGGLE_BTN,
  STORYBOARD_VIEW_TOGGLE_IDLE,
} from './storyboardTableUi';

type StoryboardPanelViewMode = 'edit' | 'grid' | 'video';

const STORYBOARD_VIEW_STORAGE_KEY = 'ac_storyboard_panel_view_v1';

type Props = {
  asset: WorkflowAsset;
  onClose: () => void;
  readOnly?: boolean;
  onNotify?: (level: 'info' | 'warn', message: string) => void;
  redrawPresets?: CustomAppModule[];
  defaultRedrawPresetId?: string;
  redrawPresetStorageKey?: string;
  onRedrawRow?: (rowId: string, presetId: string) => Promise<void>;
  onPatchAsset: (
    patch: Partial<WorkflowAsset> | ((prev: WorkflowAsset) => WorkflowAsset)
  ) => void;
  companionBaseUrl?: string;
  companionProjectId?: string;
};

/** 高于面板 z-[2160] */
const STORYBOARD_LIGHTBOX_Z = 'z-[2180]';

function formatDurationLabel(sec: number, hasGaps: boolean): string {
  if (hasGaps) return `已填 ${sec.toFixed(1)}s+`;
  return `${sec.toFixed(1)}s`;
}

export default function StoryboardTablePanel({
  asset,
  onClose,
  readOnly = false,
  onNotify,
  redrawPresets = [],
  defaultRedrawPresetId = '',
  redrawPresetStorageKey = 'ac_storyboard_redraw_preset_v1',
  onRedrawRow,
  onPatchAsset,
  companionBaseUrl = '',
  companionProjectId = '',
}: Props) {
  const table = useMemo(() => normalizeStoryboardTableDoc(asset.storyboardTable), [asset.storyboardTable]);
  const stats = useMemo(() => computeStoryboardTableStats(table), [table]);
  const storyboardExportTask = useStoryboardVideoExportTask();
  const isExportRunning = storyboardExportTask?.status === 'running';
  const isThisAssetExporting =
    isExportRunning && storyboardExportTask.assetId === asset.id;
  const canExportVideo = useMemo(() => canExportStoryboardVideo(table.rows, table.timelineLayerCount), [table.rows, table.timelineLayerCount]);
  const timelineLayerCount = table.timelineLayerCount ?? 1;

  const handleStartVideoExport = useCallback(() => {
    const title = resolveStoryboardTableTitle(asset);
    void startStoryboardVideoExportTask({
      assetId: asset.id,
      assetTitle: title,
      rows: table.rows,
      timelineLayerCount,
      onNotify,
    });
  }, [asset, onNotify, table.rows, timelineLayerCount]);
  const [viewMode, setViewMode] = useState<StoryboardPanelViewMode>(() =>
    readLocalJson(STORYBOARD_VIEW_STORAGE_KEY, 'edit', (v) =>
      v === 'grid' || v === 'edit' || v === 'video' ? v : null
    )
  );
  const isGridView = viewMode === 'grid';
  const isVideoView = viewMode === 'video';
  const isEditView = viewMode === 'edit';
  const [activeRowId, setActiveRowId] = useState<string | null>(table.rows[0]?.id ?? null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [imageBusyRowId, setImageBusyRowId] = useState<string | null>(null);
  const [redrawBusyRowId, setRedrawBusyRowId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingRowIdRef = useRef<string | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const editViewRef = useRef<StoryboardTableEditViewHandle>(null);
  const gridScrollToRowRef = useRef<((rowId: string) => void) | null>(null);
  const pendingEditRowIdRef = useRef<string | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const navigateToRow = useCallback(
    (rowId: string) => {
      setActiveRowId(rowId);
      requestAnimationFrame(() => {
        if (viewMode === 'grid') {
          gridScrollToRowRef.current?.(rowId);
          document.getElementById(storyboardCompositeDomId(rowId))?.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
          });
          return;
        }
        if (viewMode === 'video') return;
        editViewRef.current?.scrollToRow(rowId);
      });
    },
    [viewMode]
  );

  const openRowInEditor = useCallback(
    (rowId: string) => {
      setActiveRowId(rowId);
      pendingEditRowIdRef.current = rowId;
      setViewMode('edit');
      writeLocalJson(STORYBOARD_VIEW_STORAGE_KEY, 'edit');
    },
    []
  );

  useEffect(() => {
    const rowId = pendingEditRowIdRef.current;
    if (viewMode !== 'edit' || !rowId) return;
    pendingEditRowIdRef.current = null;
    let outer = 0;
    let inner = 0;
    outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => editViewRef.current?.scrollToRow(rowId));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [viewMode]);

  const setPanelViewMode = useCallback((mode: StoryboardPanelViewMode) => {
    setViewMode(mode);
    writeLocalJson(STORYBOARD_VIEW_STORAGE_KEY, mode);
  }, []);

  useEffect(() => {
    if (viewMode !== 'edit') return;
    const firstId = table.rows[0]?.id;
    if (firstId) editViewRef.current?.scrollToRow(firstId);
  }, [asset.id, viewMode]);

  const title = readStoryboardTableTitleRaw(asset);

  const effectiveRedrawPresetId = useMemo(() => {
    const stored = readLocalJson(redrawPresetStorageKey, defaultRedrawPresetId, (v) =>
      typeof v === 'string' ? v : null
    );
    if (stored && redrawPresets.some((p) => p.id === stored)) return stored;
    if (defaultRedrawPresetId && redrawPresets.some((p) => p.id === defaultRedrawPresetId)) {
      return defaultRedrawPresetId;
    }
    return redrawPresets[0]?.id ?? '';
  }, [defaultRedrawPresetId, redrawPresets, redrawPresetStorageKey]);

  useEffect(() => {
    if (!table.rows.length) {
      setActiveRowId(null);
      return;
    }
    if (!activeRowId || !table.rows.some((r) => r.id === activeRowId)) {
      setActiveRowId(table.rows[0]!.id);
    }
  }, [activeRowId, table.rows]);

  /** 仅挂载时抢焦点到关闭钮；勿把 onClose 放进 deps（父组件每次 patch 会换新函数，会反复抢走行内输入焦点）。 */
  useEffect(() => {
    closeBtnRef.current?.focus({ preventScroll: true });
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !lightboxSrc) {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [lightboxSrc]);

  const patchTable = useCallback(
    (mutate: (rows: StoryboardTableRow[]) => StoryboardTableRow[]) => {
      onPatchAsset((cur) => {
        const doc = normalizeStoryboardTableDoc(cur.storyboardTable);
        const titleRaw = readStoryboardTableTitleRaw(cur);
        const nextRows = reindexStoryboardRows(mutate([...doc.rows]));
        return {
          ...cur,
          textTitle: titleRaw,
          storyboardTable: {
            title: titleRaw,
            rows: nextRows,
            timelineLayerCount: doc.timelineLayerCount,
          },
        };
      });
    },
    [onPatchAsset]
  );

  const patchRow = useCallback(
    (rowId: string, patch: Partial<StoryboardTableRow>) => {
      patchTable((rows) => rows.map((r) => (r.id === rowId ? { ...r, ...patch } : r)));
    },
    [patchTable]
  );

  const addRow = () => {
    const row = createStoryboardTableRow({}, table.rows.length);
    patchTable((rows) => [...rows, row]);
    navigateToRow(row.id);
  };

  const duplicateRow = (rowId: string) => {
    const i = table.rows.findIndex((r) => r.id === rowId);
    if (i < 0) return;
    const copy = duplicateStoryboardRow(table.rows[i]!, table.rows.length);
    patchTable((rows) => {
      const next = [...rows];
      next.splice(i + 1, 0, copy);
      return next;
    });
    navigateToRow(copy.id);
  };

  const removeRow = (rowId: string) => {
    if (table.rows.length <= 1) return;
    if (!window.confirm('删除该镜头行？')) return;
    patchTable((rows) => rows.filter((r) => r.id !== rowId));
    if (activeRowId === rowId) setActiveRowId(null);
  };

  const moveRow = (rowId: string, dir: -1 | 1) => {
    patchTable((rows) => {
      const i = rows.findIndex((r) => r.id === rowId);
      if (i < 0) return rows;
      const j = i + dir;
      if (j < 0 || j >= rows.length) return rows;
      const next = [...rows];
      const [item] = next.splice(i, 1);
      next.splice(j, 0, item);
      return next;
    });
  };

  const openFileForRow = (rowId: string) => {
    pendingRowIdRef.current = rowId;
    fileInputRef.current?.click();
  };

  const onFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const rowId = pendingRowIdRef.current;
    pendingRowIdRef.current = null;
    if (!file || !rowId) return;
    await assignFrameImage(rowId, file);
  };

  const assignFrameImage = useCallback(
    async (rowId: string, file: File | null, clipboard?: DataTransfer | null) => {
      setImageBusyRowId(rowId);
      try {
        let dataUrl: string | null = null;
        if (file) dataUrl = await readStoryboardFrameFromFile(file);
        else dataUrl = await readStoryboardFrameFromClipboard(clipboard ?? null);
        if (!dataUrl) return;
        const patch = await persistStoryboardFrameImage({
          dataUrl,
          assetId: asset.id,
          rowId,
          companionBaseUrl,
          companionProjectId,
        });
        patchRow(rowId, patch);
      } catch (err) {
        onNotify?.('warn', err instanceof Error ? err.message : '图片处理失败');
      } finally {
        setImageBusyRowId(null);
      }
    },
    [asset.id, companionBaseUrl, companionProjectId, onNotify, patchRow]
  );

  const runRedraw = useCallback(
    async (rowId: string) => {
      if (!onRedrawRow || !effectiveRedrawPresetId) {
        onNotify?.('warn', '请先在功能区启用文生图/图生图能力');
        return;
      }
      const row = table.rows.find((r) => r.id === rowId);
      if (!row) return;
      if (row.locked) {
        onNotify?.('warn', '该镜头已锁定');
        return;
      }
      if (!buildStoryboardRowPromptText(row)) {
        onNotify?.('warn', '请先填写镜头文本');
        return;
      }
      setRedrawBusyRowId(rowId);
      try {
        await onRedrawRow(rowId, effectiveRedrawPresetId);
      } catch (e) {
        onNotify?.('warn', e instanceof Error ? e.message : '重绘失败');
      } finally {
        setRedrawBusyRowId(null);
      }
    },
    [effectiveRedrawPresetId, onNotify, onRedrawRow, table.rows]
  );

  const reorderLayerRows = useCallback(
    (layer: number, fromIndex: number, toIndex: number) => {
      patchTable((rows) => reorderStoryboardRowsInLayer(rows, layer, fromIndex, toIndex));
    },
    [patchTable]
  );

  const addTimelineLayer = useCallback(() => {
    onPatchAsset((cur) => {
      const doc = normalizeStoryboardTableDoc(cur.storyboardTable);
      const titleRaw = readStoryboardTableTitleRaw(cur);
      const nextCount = clampStoryboardTimelineLayerCount((doc.timelineLayerCount ?? 1) + 1);
      return {
        ...cur,
        textTitle: titleRaw,
        storyboardTable: { ...doc, title: titleRaw, timelineLayerCount: nextCount },
      };
    });
  }, [onPatchAsset]);

  const removeTimelineLayer = useCallback(() => {
    if (timelineLayerCount <= 1) return;
    onPatchAsset((cur) => {
      const doc = normalizeStoryboardTableDoc(cur.storyboardTable);
      const titleRaw = readStoryboardTableTitleRaw(cur);
      const collapsed = collapseStoryboardTimelineTopLayer(doc.rows, doc.timelineLayerCount ?? 1);
      return {
        ...cur,
        textTitle: titleRaw,
        storyboardTable: {
          ...doc,
          title: titleRaw,
          rows: reindexStoryboardRows(collapsed.rows),
          timelineLayerCount: collapsed.layerCount,
        },
      };
    });
  }, [onPatchAsset, timelineLayerCount]);

  const redrawRowDisabledReason = useCallback(
    (row: StoryboardTableRow): string | undefined => {
      if (readOnly) return '只读模式';
      if (row.locked) return '已锁定';
      if (!redrawPresets.length) return '无可用生图能力';
      if (!buildStoryboardRowPromptText(row)) return '需填写镜头文本';
      const preset = redrawPresets.find((p) => p.id === effectiveRedrawPresetId);
      if (preset?.category === 'image_to_image' && !storyboardRowHasFrameRef(row)) {
        return '图生图需先有分镜图，或改选文生图';
      }
      return undefined;
    },
    [effectiveRedrawPresetId, readOnly, redrawPresets]
  );

  const rowInteraction = useMemo((): StoryboardRowInteractionValue => {
    return {
      rowCount: table.rows.length,
      readOnly,
      timelineLayerCount,
      hasRedrawHandler: Boolean(onRedrawRow),
      focusRow: setActiveRowId,
      patchRow,
      moveRow,
      removeRow,
      openFileForRow,
      clearRowImage: (rowId) =>
        patchRow(rowId, {
          frameImage: undefined,
          frameImageObjectKey: undefined,
          frameImageCompanionKey: undefined,
        }),
      assignFrameImageFromDrop: (rowId, e) =>
        void assignFrameImage(rowId, e.dataTransfer.files?.[0] ?? null, e.dataTransfer),
      assignFrameImageFromPaste: (rowId, e) => {
        const file = e.clipboardData.files?.[0];
        if (file) {
          e.preventDefault();
          void assignFrameImage(rowId, file, e.clipboardData);
        }
      },
      runRedraw,
      previewImage: setLightboxSrc,
      redrawDisabledReason: redrawRowDisabledReason,
    };
  }, [
    assignFrameImage,
    moveRow,
    onRedrawRow,
    openFileForRow,
    patchRow,
    readOnly,
    redrawRowDisabledReason,
    removeRow,
    runRedraw,
    table.rows.length,
    timelineLayerCount,
  ]);

  const panel = (
    <div
      className="fixed inset-0 z-[2160] flex flex-col bg-[#040508]/90 backdrop-blur-xl"
      role="dialog"
      aria-modal
      aria-label={readOnly ? '分镜表（只读）' : '分镜表'}
      data-ac-block-workflow-marquee
    >
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onFilePicked} />

      <header className={`shrink-0 border-b border-white/[0.04] ${STORYBOARD_PAD_PANEL} pb-2`}>
        <div className={`flex items-center ${STORYBOARD_PAD_HEADER_INNER}`}>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            title="关闭（Esc）"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.05] text-gray-400 ring-1 ring-white/[0.07] transition-colors hover:bg-white/[0.08] hover:text-white outline-none focus-visible:ring-2 focus-visible:ring-violet-500/45"
            aria-label="关闭"
          >
            <AppIcon name="close" className="h-4 w-4" />
          </button>

          <div className={STORYBOARD_VIEW_TOGGLE} role="group" aria-label="分镜表视图">
            <button
              type="button"
              onClick={() => setPanelViewMode('edit')}
              className={`${STORYBOARD_VIEW_TOGGLE_BTN} ${
                isEditView ? STORYBOARD_VIEW_TOGGLE_ACTIVE : STORYBOARD_VIEW_TOGGLE_IDLE
              }`}
              aria-pressed={isEditView}
            >
              编辑
            </button>
            <button
              type="button"
              onClick={() => setPanelViewMode('grid')}
              className={`${STORYBOARD_VIEW_TOGGLE_BTN} ${
                isGridView ? STORYBOARD_VIEW_TOGGLE_ACTIVE : STORYBOARD_VIEW_TOGGLE_IDLE
              }`}
              aria-pressed={isGridView}
            >
              网格
            </button>
            <button
              type="button"
              onClick={() => setPanelViewMode('video')}
              className={`${STORYBOARD_VIEW_TOGGLE_BTN} ${
                isVideoView ? STORYBOARD_VIEW_TOGGLE_ACTIVE : STORYBOARD_VIEW_TOGGLE_IDLE
              }`}
              aria-pressed={isVideoView}
            >
              视频
            </button>
          </div>

          <input
            value={title}
            readOnly={readOnly}
            onChange={(e) => {
              const v = e.target.value;
              onPatchAsset((cur) => {
                const doc = normalizeStoryboardTableDoc(cur.storyboardTable);
                return {
                  ...cur,
                  textTitle: v,
                  storyboardTable: { ...doc, title: v },
                };
              });
            }}
            className="min-w-0 flex-1 bg-transparent text-base font-semibold tracking-tight text-white outline-none placeholder:text-gray-600 read-only:cursor-default sm:text-lg"
            placeholder="未命名分镜表"
          />

          <div className={`hidden shrink-0 items-center sm:flex ${STORYBOARD_GAP_TIGHT}`}>
            <span className={STORYBOARD_STAT_CHIP}>{stats.rowCount} 镜</span>
            <span className={STORYBOARD_STAT_CHIP}>{stats.withImageCount} 配图</span>
            <span className={STORYBOARD_STAT_CHIP}>
              {formatDurationLabel(stats.totalDurationSec, stats.hasGaps)}
            </span>
            {stats.lockedCount > 0 ? (
              <span className={STORYBOARD_STAT_CHIP}>{stats.lockedCount} 锁定</span>
            ) : null}
          </div>
        </div>

        <div className={`mt-1.5 flex flex-wrap items-center ${STORYBOARD_GAP_TIGHT} pl-11 sm:hidden`}>
          <span className={STORYBOARD_STAT_CHIP}>{stats.rowCount} 镜</span>
          <span className={STORYBOARD_STAT_CHIP}>{stats.withImageCount} 配图</span>
          <span className={STORYBOARD_STAT_CHIP}>
            {formatDurationLabel(stats.totalDurationSec, stats.hasGaps)}
          </span>
        </div>

        {isEditView && !readOnly ? (
          <div className={`mt-2 flex flex-wrap items-center ${STORYBOARD_GAP_TIGHT} pl-11`}>
            <button type="button" onClick={addRow} className={STORYBOARD_TOOL_BTN_PRIMARY}>
              添加镜头
            </button>
            <button
              type="button"
              onClick={() => patchTable((rows) => applyAutoShotNumbers(rows))}
              className={STORYBOARD_TOOL_BTN_NEUTRAL}
            >
              自动镜头号
            </button>
            {activeRowId ? (
              <button
                type="button"
                onClick={() => duplicateRow(activeRowId)}
                className={STORYBOARD_TOOL_BTN_GHOST}
              >
                复制当前镜
              </button>
            ) : null}
          </div>
        ) : null}

        {storyboardExportTask?.status === 'running' && storyboardExportTask.assetId === asset.id ? (
          <StoryboardVideoExportProgress
            progress={storyboardExportTask.progress}
            className="mt-2 pl-11"
          />
        ) : null}
      </header>

      {isGridView ? (
        <StoryboardTableGridPreview
          rows={table.rows}
          activeRowId={activeRowId}
          onSelect={(rowId) => navigateToRow(rowId)}
          onOpenInEditor={openRowInEditor}
          onPreviewImage={setLightboxSrc}
          scrollToRowRef={gridScrollToRowRef}
        />
      ) : isVideoView ? (
        <StoryboardTableVideoPreview
          rows={table.rows}
          timelineLayerCount={timelineLayerCount}
          activeRowId={activeRowId}
          readOnly={readOnly}
          canExport={canExportVideo}
          exporting={isThisAssetExporting}
          exportDisabled={isExportRunning}
          onExport={handleStartVideoExport}
          onSelectRow={(rowId) => setActiveRowId(rowId)}
          onActiveRowFromPlayback={setActiveRowId}
          onReorderLayer={reorderLayerRows}
          onAddTimelineLayer={addTimelineLayer}
          onRemoveTimelineLayer={removeTimelineLayer}
        />
      ) : (
        <StoryboardTableEditView
          key={asset.id}
          rows={table.rows}
          activeRowId={activeRowId}
          imageBusyRowId={imageBusyRowId}
          redrawBusyRowId={redrawBusyRowId}
          interaction={rowInteraction}
          onActiveRowIdChange={setActiveRowId}
          redrawRowDisabledReason={redrawRowDisabledReason}
          editScrollRef={editViewRef}
          footerAddRow={
            !readOnly ? (
              <button type="button" onClick={addRow} className={STORYBOARD_ADD_ROW_DASHED}>
                <span className="text-base leading-none text-violet-400/80">+</span>
                添加镜头
              </button>
            ) : null
          }
        />
      )}

    </div>
  );

  return (
    <>
      {typeof document !== 'undefined' ? createPortal(panel, document.body) : panel}
      {lightboxSrc ? (
        <ImagePreviewOverlay
          open
          imageSrc={lightboxSrc}
          onClose={() => setLightboxSrc(null)}
          shellZIndexClassName={STORYBOARD_LIGHTBOX_Z}
        />
      ) : null}
    </>
  );
}
