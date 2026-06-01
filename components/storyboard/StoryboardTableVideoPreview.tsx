import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { StoryboardParseFieldDef, StoryboardTableRow } from '../../types';
import { readLocalJson, writeLocalJson } from '../../services/clientPersist';
import {
  buildStoryboardVideoLayers,
  findStoryboardRowStartTime,
} from '../../services/storyboardVideoTimeline';
import {
  getStoryboardVideoAspectPreset,
  STORYBOARD_VIDEO_ASPECT_PRESETS,
  STORYBOARD_VIDEO_ASPECT_STORAGE_KEY,
  type StoryboardVideoAspectPresetId,
} from '../../services/storyboardVideoAspect';
import { pickStoryboardWebmMimeType, describeStoryboardWebmMime } from '../../services/storyboardVideoExport';
import StoryboardVideoTimeline from './StoryboardVideoTimeline';
import StoryboardVideoSeekBar from './StoryboardVideoSeekBar';
import { useStoryboardVideoPlayback } from './useStoryboardVideoPlayback';
import { useStoryboardVideoFitBox } from './useStoryboardVideoFitBox';
import { useStoryboardVideoPaneSplit } from './useStoryboardVideoPaneSplit';
import AppIcon from '../ui/AppIcon';
import {
  STORYBOARD_GAP_TIGHT,
  STORYBOARD_PAD_PANEL,
  STORYBOARD_VIDEO_ICON_BTN_NEUTRAL,
  STORYBOARD_VIDEO_ICON_BTN_PRIMARY,
  STORYBOARD_VIEW_TOGGLE,
  STORYBOARD_VIEW_TOGGLE_ACTIVE,
  STORYBOARD_VIEW_TOGGLE_BTN,
  STORYBOARD_VIEW_TOGGLE_IDLE,
} from './storyboardTableUi';

type Props = {
  rows: StoryboardTableRow[];
  fieldCatalog?: StoryboardParseFieldDef[];
  timelineLayerCount: number;
  activeRowId: string | null;
  readOnly?: boolean;
  canExport?: boolean;
  exporting?: boolean;
  exportDisabled?: boolean;
  onExport?: () => void;
  onSelectRow: (rowId: string) => void;
  onActiveRowFromPlayback?: (rowId: string) => void;
  onReorderLayer: (layer: number, fromIndex: number, toIndex: number) => void;
  onAddTimelineLayer: () => void;
  onRemoveTimelineLayer: () => void;
};

export default function StoryboardTableVideoPreview({
  rows,
  fieldCatalog = [],
  timelineLayerCount,
  activeRowId,
  readOnly = false,
  canExport = false,
  exporting = false,
  exportDisabled = false,
  onExport,
  onSelectRow,
  onActiveRowFromPlayback,
  onReorderLayer,
  onAddTimelineLayer,
  onRemoveTimelineLayer,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewPaneRef = useRef<HTMLDivElement>(null);
  const [aspectId, setAspectId] = useState<StoryboardVideoAspectPresetId>(() =>
    readLocalJson(STORYBOARD_VIDEO_ASPECT_STORAGE_KEY, '16:9', (v) =>
      STORYBOARD_VIDEO_ASPECT_PRESETS.some((p) => p.id === v) ? (v as StoryboardVideoAspectPresetId) : null
    )
  );
  const aspect = useMemo(() => getStoryboardVideoAspectPreset(aspectId), [aspectId]);
  const fitSize = useStoryboardVideoFitBox(previewPaneRef, aspect);

  const layers = useMemo(
    () => buildStoryboardVideoLayers(rows, timelineLayerCount, fieldCatalog),
    [fieldCatalog, rows, timelineLayerCount]
  );
  const hasAnySegment = layers.some((l) => l.segments.length > 0);
  const {
    playing,
    timeSec,
    totalDuration,
    activeRowId: playbackRowId,
    seek,
    togglePlay,
    pause,
  } = useStoryboardVideoPlayback(layers, canvasRef, {
    fieldCatalog,
  });

  const { bodyRef, previewHeight, timelineHeight, splitterPx, onSplitterPointerDown } =
    useStoryboardVideoPaneSplit();

  const displayActiveRowId = playbackRowId ?? activeRowId;

  useEffect(() => {
    if (playbackRowId) onActiveRowFromPlayback?.(playbackRowId);
  }, [onActiveRowFromPlayback, playbackRowId]);

  const handleSelectRow = useCallback(
    (rowId: string) => {
      onSelectRow(rowId);
      const t = findStoryboardRowStartTime(layers, rowId);
      if (t != null) seek(t);
    },
    [layers, onSelectRow, seek]
  );

  const handleReorder = useCallback(
    (layer: number, fromIndex: number, toIndex: number) => {
      pause();
      onReorderLayer(layer, fromIndex, toIndex);
    },
    [onReorderLayer, pause]
  );

  const exportMime = useMemo(() => pickStoryboardWebmMimeType(), []);
  const exportMimeLabel = exportMime ? describeStoryboardWebmMime(exportMime) : '';

  return (
    <div className={`flex min-h-0 flex-1 flex-col overflow-hidden ${STORYBOARD_PAD_PANEL} pt-1`}>
      <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2 px-0.5">
        <span className="text-[9px] text-gray-600">画幅</span>
        <div className={STORYBOARD_VIEW_TOGGLE} role="group" aria-label="预览画幅">
          {STORYBOARD_VIDEO_ASPECT_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setAspectId(p.id);
                writeLocalJson(STORYBOARD_VIDEO_ASPECT_STORAGE_KEY, p.id);
              }}
              className={`${STORYBOARD_VIEW_TOGGLE_BTN} ${
                aspectId === p.id ? STORYBOARD_VIEW_TOGGLE_ACTIVE : STORYBOARD_VIEW_TOGGLE_IDLE
              }`}
              aria-pressed={aspectId === p.id}
              title={`${p.label} · ${p.width}×${p.height}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <span className={`text-[9px] tabular-nums text-gray-600 ${STORYBOARD_GAP_TIGHT}`}>
          {aspect.width}×{aspect.height}
        </span>
      </div>

      <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div
          className="flex min-h-0 shrink-0 flex-col gap-2 overflow-hidden"
          style={{ height: previewHeight > 0 ? previewHeight : undefined, flex: previewHeight > 0 ? '0 0 auto' : '1 1 0' }}
        >
          <div
            ref={previewPaneRef}
            className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-black/50 p-2"
          >
            <div className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-visible">
              <div
                className="relative overflow-hidden rounded-xl border border-white/[0.1] bg-black shadow-[0_8px_32px_-8px_rgba(0,0,0,0.65)]"
                style={{
                  width: Math.max(1, fitSize.width),
                  height: Math.max(1, fitSize.height),
                }}
              >
                <canvas ref={canvasRef} className="block h-full w-full" />
              </div>
              {!hasAnySegment ? (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] text-gray-600">
                  添加镜头并配图后即可预览
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 px-0.5">
            <button
              type="button"
              onClick={togglePlay}
              disabled={!hasAnySegment}
              title={playing ? '暂停' : '播放'}
              aria-label={playing ? '暂停' : '播放'}
              className={STORYBOARD_VIDEO_ICON_BTN_PRIMARY}
            >
              <AppIcon name={playing ? 'pause' : 'play'} className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => seek(0)}
              disabled={!hasAnySegment}
              title="回到开头"
              aria-label="回到开头"
              className={STORYBOARD_VIDEO_ICON_BTN_NEUTRAL}
            >
              <AppIcon name="skip-start" className="h-4 w-4" />
            </button>
            {canExport && onExport ? (
              <button
                type="button"
                onClick={onExport}
                disabled={exportDisabled || exporting}
                title={exporting ? '导出中' : `导出 ${exportMimeLabel}`}
                aria-label={exporting ? '导出中' : `导出 ${exportMimeLabel}`}
                className={STORYBOARD_VIDEO_ICON_BTN_NEUTRAL}
              >
                <AppIcon name="download" className={`h-4 w-4 ${exporting ? 'animate-pulse opacity-60' : ''}`} />
              </button>
            ) : null}
            <StoryboardVideoSeekBar
              value={Math.min(timeSec, totalDuration)}
              max={Math.max(0.1, totalDuration)}
              disabled={!hasAnySegment}
              onChange={seek}
            />
            <span className="shrink-0 text-[10px] tabular-nums text-gray-500">
              {timeSec.toFixed(1)} / {totalDuration.toFixed(1)}s
            </span>
          </div>
        </div>

        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="调节预览区与时间轴高度"
          onPointerDown={onSplitterPointerDown}
          className="group relative flex shrink-0 cursor-ns-resize items-center justify-center touch-none py-1"
          style={{ height: splitterPx }}
        >
          <div className="absolute inset-x-3 top-1/2 h-px -translate-y-1/2 bg-white/[0.06] transition-colors group-hover:bg-white/15" />
          <div className="relative flex items-center gap-0.5 rounded-full border border-white/[0.08] bg-[#121218]/90 px-2 py-0.5 shadow-sm transition-colors group-hover:border-white/20 group-active:border-white/30">
            <span className="h-0.5 w-0.5 rounded-full bg-gray-500 group-hover:bg-white/70" />
            <span className="h-0.5 w-0.5 rounded-full bg-gray-500 group-hover:bg-white/70" />
            <span className="h-0.5 w-0.5 rounded-full bg-gray-500 group-hover:bg-white/70" />
          </div>
        </div>

        <div
          className="flex min-h-0 shrink-0 flex-col overflow-hidden pb-1"
          style={{ height: timelineHeight > 0 ? timelineHeight : undefined, flex: timelineHeight > 0 ? '0 0 auto' : '0 1 8rem' }}
        >
          <StoryboardVideoTimeline
            layers={layers}
            timelineLayerCount={timelineLayerCount}
            activeRowId={displayActiveRowId}
            playheadTime={timeSec}
            totalDuration={totalDuration}
            readOnly={readOnly}
            onSelectRow={handleSelectRow}
            onSeek={seek}
            onReorderLayer={handleReorder}
            onAddLayer={onAddTimelineLayer}
            onRemoveLayer={onRemoveTimelineLayer}
          />
        </div>
      </div>
    </div>
  );
}
