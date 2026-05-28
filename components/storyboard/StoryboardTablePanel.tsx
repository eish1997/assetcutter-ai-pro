import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CustomAppModule, StoryboardTableRow, WorkflowAsset } from '../../types';
import {
  applyAutoShotNumbers,
  computeStoryboardTableStats,
  createStoryboardTableRow,
  duplicateStoryboardRow,
  normalizeStoryboardTableDoc,
  reindexStoryboardRows,
} from '../../services/storyboardTableAsset';
import { buildStoryboardRowPromptText } from '../../services/storyboardTableRedraw';
import { readLocalJson, writeLocalJson } from '../../services/clientPersist';
import { readStoryboardFrameFromClipboard, readStoryboardFrameFromFile } from './storyboardFrameImage';
import { ImagePreviewOverlay } from '../ImagePreviewOverlay';
import AppIcon from '../ui/AppIcon';
import { CustomDropdown } from '../ui/CustomDropdown';
import StoryboardTableRowEditor from './StoryboardTableRowEditor';
import StoryboardTableOutlineSidebar from './StoryboardTableOutlineSidebar';
import StoryboardTableCompositeColumn from './StoryboardTableCompositeColumn';
import StoryboardTableGridPreview from './StoryboardTableGridPreview';
import { storyboardCompositeDomId, storyboardRowDomId } from './storyboardTableDom';
import { useStoryboardRowHeights } from './useStoryboardRowHeights';
import {
  STORYBOARD_ADD_ROW_DASHED,
  STORYBOARD_COLUMN_HEAD,
  STORYBOARD_BODY_SCROLL,
  STORYBOARD_GAP_STACK,
  STORYBOARD_GRID_EDITOR_PREVIEW,
  STORYBOARD_GRID_ROOT,
  STORYBOARD_SIDE_RAIL,
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

type StoryboardPanelViewMode = 'edit' | 'grid';

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
};

const REDRAW_DROPDOWN_Z = { backdrop: 2200, list: 2201 };
/** 高于面板 z-[2160]，低于下拉 portal */
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
}: Props) {
  const table = useMemo(() => normalizeStoryboardTableDoc(asset.storyboardTable), [asset.storyboardTable]);
  const stats = useMemo(() => computeStoryboardTableStats(table), [table]);
  const [viewMode, setViewMode] = useState<StoryboardPanelViewMode>(() =>
    readLocalJson(STORYBOARD_VIEW_STORAGE_KEY, 'edit', (v) =>
      v === 'grid' || v === 'edit' ? v : null
    )
  );
  const isGridView = viewMode === 'grid';
  const rowHeights = useStoryboardRowHeights(isGridView ? [] : table.rows);
  const [activeRowId, setActiveRowId] = useState<string | null>(table.rows[0]?.id ?? null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [imageBusyRowId, setImageBusyRowId] = useState<string | null>(null);
  const [redrawBusyRowId, setRedrawBusyRowId] = useState<string | null>(null);
  const [redrawPresetId, setRedrawPresetId] = useState(() =>
    readLocalJson(redrawPresetStorageKey, defaultRedrawPresetId, (v) =>
      typeof v === 'string' ? v : null
    )
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingRowIdRef = useRef<string | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const mainScrollRef = useRef<HTMLDivElement>(null);
  const compositeScrollRef = useRef<HTMLDivElement>(null);
  const pendingEditRowIdRef = useRef<string | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const scrollEditorToRow = useCallback((rowId: string) => {
    document.getElementById(storyboardRowDomId(rowId))?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
    const compositeEl = document.getElementById(storyboardCompositeDomId(rowId));
    const container = compositeScrollRef.current;
    if (compositeEl && container) {
      const top =
        compositeEl.getBoundingClientRect().top -
        container.getBoundingClientRect().top +
        container.scrollTop;
      container.scrollTo({ top: Math.max(0, top - 8), behavior: 'smooth' });
    }
  }, []);

  const navigateToRow = useCallback(
    (rowId: string) => {
      setActiveRowId(rowId);
      requestAnimationFrame(() => {
        if (viewMode === 'grid') {
          document.getElementById(storyboardCompositeDomId(rowId))?.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
          });
          return;
        }
        scrollEditorToRow(rowId);
      });
    },
    [scrollEditorToRow, viewMode]
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
      inner = requestAnimationFrame(() => scrollEditorToRow(rowId));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [scrollEditorToRow, viewMode]);

  const setPanelViewMode = useCallback((mode: StoryboardPanelViewMode) => {
    setViewMode(mode);
    writeLocalJson(STORYBOARD_VIEW_STORAGE_KEY, mode);
  }, []);

  useEffect(() => {
    mainScrollRef.current?.scrollTo(0, 0);
    compositeScrollRef.current?.scrollTo(0, 0);
  }, [asset.id]);

  const title = (asset.textTitle || table.title || '分镜表').trim() || '分镜表';

  const redrawOptions = useMemo(
    () =>
      redrawPresets.map((p) => ({
        value: p.id,
        label: p.label || p.id,
        title: p.category === 'image_to_image' ? '图生图（需本镜有参考图）' : '文生图',
      })),
    [redrawPresets]
  );

  const effectiveRedrawPresetId = useMemo(() => {
    if (redrawPresetId && redrawPresets.some((p) => p.id === redrawPresetId)) {
      return redrawPresetId;
    }
    return redrawPresets[0]?.id ?? '';
  }, [redrawPresetId, redrawPresets]);

  useEffect(() => {
    if (effectiveRedrawPresetId && effectiveRedrawPresetId !== redrawPresetId) {
      setRedrawPresetId(effectiveRedrawPresetId);
    }
  }, [effectiveRedrawPresetId, redrawPresetId]);

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

  /** 中间编辑区滚动时同步当前镜（驱动左大纲 / 右合成高亮） */
  useEffect(() => {
    if (isGridView) return;
    const root = mainScrollRef.current;
    if (!root || table.rows.length === 0) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const hit = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!hit?.target.id?.startsWith('ac-storyboard-row-')) return;
        const rowId = hit.target.id.slice('ac-storyboard-row-'.length);
        if (table.rows.some((r) => r.id === rowId)) {
          setActiveRowId(rowId);
        }
      },
      { root, rootMargin: '-28% 0px -48% 0px', threshold: [0.12, 0.35, 0.55, 0.75] }
    );
    for (const row of table.rows) {
      const el = document.getElementById(storyboardRowDomId(row.id));
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  }, [isGridView, table.rows]);

  const patchTable = useCallback(
    (mutate: (rows: StoryboardTableRow[]) => StoryboardTableRow[]) => {
      onPatchAsset((cur) => {
        const doc = normalizeStoryboardTableDoc(cur.storyboardTable);
        const t = (cur.textTitle || doc.title || '分镜表').trim() || '分镜表';
        const nextRows = reindexStoryboardRows(mutate([...doc.rows]));
        return {
          ...cur,
          textTitle: t,
          storyboardTable: { title: t, rows: nextRows },
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
        patchRow(rowId, { frameImage: dataUrl, frameImageObjectKey: undefined });
      } catch (err) {
        onNotify?.('warn', err instanceof Error ? err.message : '图片处理失败');
      } finally {
        setImageBusyRowId(null);
      }
    },
    [onNotify, patchRow]
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

  const redrawRowDisabledReason = (row: StoryboardTableRow): string | undefined => {
    if (readOnly) return '只读模式';
    if (row.locked) return '已锁定';
    if (!redrawPresets.length) return '无可用生图能力';
    if (!buildStoryboardRowPromptText(row)) return '需填写镜头文本';
    const preset = redrawPresets.find((p) => p.id === effectiveRedrawPresetId);
    if (preset?.category === 'image_to_image' && !String(row.frameImage || '').trim()) {
      return '图生图需先有分镜图，或改选文生图';
    }
    return undefined;
  };

  const panel = (
    <div
      className="fixed inset-0 z-[2160] flex flex-col bg-[#040508]/90 backdrop-blur-xl"
      role="dialog"
      aria-modal
      aria-label={readOnly ? '分镜表（只读）' : '分镜表'}
      data-ac-block-workflow-marquee
    >
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onFilePicked} />

      <header className={`shrink-0 border-b border-white/[0.04] ${STORYBOARD_PAD_PANEL}`}>
        <div className={`flex items-start ${STORYBOARD_PAD_HEADER_INNER}`}>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            title="关闭（Esc）"
            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.05] text-gray-400 ring-1 ring-white/[0.07] transition-colors hover:bg-white/[0.08] hover:text-white outline-none focus-visible:ring-2 focus-visible:ring-violet-500/45"
            aria-label="关闭"
          >
            <AppIcon name="close" className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <div className={`mb-0.5 flex flex-wrap items-center ${STORYBOARD_GAP_TIGHT}`}>
              <div className={STORYBOARD_VIEW_TOGGLE} role="group" aria-label="分镜表视图">
                <button
                  type="button"
                  onClick={() => setPanelViewMode('edit')}
                  className={`${STORYBOARD_VIEW_TOGGLE_BTN} ${
                    !isGridView ? STORYBOARD_VIEW_TOGGLE_ACTIVE : STORYBOARD_VIEW_TOGGLE_IDLE
                  }`}
                  aria-pressed={!isGridView}
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
                  网格预览
                </button>
              </div>
              <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-violet-400/85">
                {readOnly ? '只读预览' : 'Storyboard'}
              </span>
              <span className={STORYBOARD_STAT_CHIP}>{stats.rowCount} 镜</span>
              <span className={STORYBOARD_STAT_CHIP}>{stats.withImageCount} 配图</span>
              <span className={STORYBOARD_STAT_CHIP}>
                {formatDurationLabel(stats.totalDurationSec, stats.hasGaps)}
              </span>
              {stats.lockedCount > 0 ? (
                <span className={STORYBOARD_STAT_CHIP}>{stats.lockedCount} 锁定</span>
              ) : null}
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
              className="w-full bg-transparent text-xl font-semibold tracking-tight text-white outline-none placeholder:text-gray-600 read-only:cursor-default sm:text-[1.35rem]"
              placeholder="未命名分镜表"
            />
          </div>
        </div>

        {!readOnly ? (
          <div className={`flex flex-wrap items-center ${STORYBOARD_PAD_TOOLBAR}`}>
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
            {onRedrawRow ? (
              <div className={`ml-auto flex min-w-[11rem] items-center ${STORYBOARD_GAP_TIGHT}`}>
                <span className="hidden text-[9px] text-gray-600 sm:inline">重绘</span>
                <CustomDropdown
                  value={effectiveRedrawPresetId}
                  options={
                    redrawOptions.length > 0
                      ? redrawOptions
                      : [{ value: '', label: '无可用能力', disabled: true }]
                  }
                  disabled={redrawOptions.length === 0}
                  onChange={(id) => {
                    setRedrawPresetId(id);
                    writeLocalJson(redrawPresetStorageKey, id);
                  }}
                  placeholder="文生图 / 图生图"
                  triggerClassName="h-8 min-w-[11rem] rounded-lg bg-white/[0.04] px-2.5 text-[10px] text-gray-200 ring-1 ring-white/[0.07] hover:bg-white/[0.07]"
                  portalZIndex={REDRAW_DROPDOWN_Z}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </header>

      {isGridView ? (
        <StoryboardTableGridPreview
          rows={table.rows}
          activeRowId={activeRowId}
          onSelect={(rowId) => navigateToRow(rowId)}
          onOpenInEditor={openRowInEditor}
          onPreviewImage={setLightboxSrc}
        />
      ) : (
      <div className={`${STORYBOARD_GRID_ROOT} ${STORYBOARD_PAD_PANEL} overflow-x-auto pt-2`}>
        <StoryboardTableOutlineSidebar
          rows={table.rows}
          activeRowId={activeRowId}
          onSelect={(rowId) => navigateToRow(rowId)}
        />

        <div className={`${STORYBOARD_GRID_EDITOR_PREVIEW} h-full`}>
          <div className={`${STORYBOARD_SIDE_RAIL} min-w-0`}>
            <p className={STORYBOARD_COLUMN_HEAD}>镜头编辑</p>
            <div ref={mainScrollRef} className={`${STORYBOARD_BODY_SCROLL} pr-0.5`}>
              <div className={`flex w-full min-w-0 flex-col ${STORYBOARD_GAP_STACK}`}>
                {table.rows.map((row, i) => {
                  const redrawReason = redrawRowDisabledReason(row);
                  return (
                    <StoryboardTableRowEditor
                      key={row.id}
                      domId={storyboardRowDomId(row.id)}
                      row={row}
                      index={i}
                      rowCount={table.rows.length}
                      active={activeRowId === row.id}
                      readOnly={readOnly}
                      imageBusy={imageBusyRowId === row.id}
                      onFocusRow={() => setActiveRowId(row.id)}
                      onPatch={(patch) => patchRow(row.id, patch)}
                      onMove={(dir) => moveRow(row.id, dir)}
                      onRemove={() => removeRow(row.id)}
                      onPickImage={() => openFileForRow(row.id)}
                      onClearImage={() =>
                        patchRow(row.id, { frameImage: undefined, frameImageObjectKey: undefined })
                      }
                      onPreviewImage={setLightboxSrc}
                      onImageDrop={(e) =>
                        void assignFrameImage(
                          row.id,
                          e.dataTransfer.files?.[0] ?? null,
                          e.dataTransfer
                        )
                      }
                      onImagePaste={(e) => {
                        const file = e.clipboardData.files?.[0];
                        if (file) {
                          e.preventDefault();
                          void assignFrameImage(row.id, file, e.clipboardData);
                        }
                      }}
                      redrawBusy={redrawBusyRowId === row.id}
                      redrawDisabled={Boolean(redrawReason) || redrawBusyRowId != null}
                      redrawDisabledReason={redrawReason}
                      onRedraw={
                        onRedrawRow && !readOnly ? () => void runRedraw(row.id) : undefined
                      }
                    />
                  );
                })}

                {!readOnly ? (
                  <button type="button" onClick={addRow} className={STORYBOARD_ADD_ROW_DASHED}>
                    <span className="text-base leading-none text-violet-400/80">+</span>
                    添加镜头
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          <StoryboardTableCompositeColumn
            rows={table.rows}
            rowHeights={rowHeights}
            activeRowId={activeRowId}
            onSelect={navigateToRow}
            onPreviewImage={setLightboxSrc}
            scrollRef={compositeScrollRef}
          />
        </div>
      </div>
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
