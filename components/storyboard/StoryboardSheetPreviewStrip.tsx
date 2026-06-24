import React, { useRef } from 'react';
import type { StoryboardSheetPreviewItem } from '../../services/storyboardSheetPreview';
import { formatSheetPreviewShotLabel } from '../../services/storyboardSheetPreview';
import { collectStoryboardFrameImageFiles } from '../../services/storyboardTableFrameImport';
import AppIcon from '../ui/AppIcon';
import StoryboardSheetPreviewVersionMenu from './StoryboardSheetPreviewVersionMenu';
import { STORYBOARD_GAP_TIGHT } from './storyboardTableUi';

type Props = {
  sheetPreviews: StoryboardSheetPreviewItem[];
  sheetSplitBusyId?: string | null;
  sheetRegenBusyId?: string | null;
  busy?: boolean;
  progress?: { done: number; total: number } | null;
  progressLabel?: string;
  readOnly?: boolean;
  onPreview: (preview: StoryboardSheetPreviewItem) => void;
  onUpload?: (files: File[]) => void;
  onApplySheet?: (previewId: string) => void;
  onRegenerateSheet?: (previewId: string) => void;
  onSelectSheetVersion?: (previewId: string, versionId: string) => void;
  onDeleteSheet?: (previewId: string) => void;
  onCancelGen?: () => void;
  onCancelGenTask?: (previewId: string) => void;
};

function isPreviewGenerating(preview: StoryboardSheetPreviewItem): boolean {
  return preview.genStatus === 'pending' || preview.genStatus === 'generating';
}

function previewHasImage(preview: StoryboardSheetPreviewItem): boolean {
  return Boolean(String(preview.imageDataUrl || '').trim());
}

function isGeneratedTaskTerminal(preview: StoryboardSheetPreviewItem): boolean {
  return (
    preview.source === 'generated' &&
    (preview.genStatus === 'failed' || preview.genStatus === 'cancelled')
  );
}

function canShowSheetCornerDelete(preview: StoryboardSheetPreviewItem): boolean {
  if (isPreviewGenerating(preview) || isGeneratedTaskTerminal(preview)) return false;
  return preview.source === 'uploaded' || preview.source === 'generated';
}

/** 拼图多为横向 contact sheet，需完整显示；每行 5 张均分宽度 */
const SHEET_PREVIEW_CARD =
  'relative h-[4.25rem] w-full min-w-0 overflow-hidden rounded-lg ring-1 ring-white/[0.08]';
const SHEET_PREVIEW_IMG = 'h-full w-full object-contain bg-black/25';
const SHEET_PREVIEW_COL = 'flex min-w-0 w-full flex-col gap-1';
const SHEET_PREVIEW_SLOT =
  'flex h-[4.25rem] w-full min-w-0 items-center justify-center rounded-lg border border-dashed border-white/[0.1] bg-white/[0.02] text-[9px] text-gray-600';

export default function StoryboardSheetPreviewStrip({
  sheetPreviews,
  sheetSplitBusyId = null,
  sheetRegenBusyId = null,
  busy = false,
  progress = null,
  progressLabel = '生成中',
  readOnly = false,
  onPreview,
  onUpload,
  onApplySheet,
  onRegenerateSheet,
  onSelectSheetVersion,
  onDeleteSheet,
  onCancelGen,
  onCancelGenTask,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onFilePicked = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = collectStoryboardFrameImageFiles(event.target.files);
    event.target.value = '';
    if (!files.length || !onUpload) return;
    onUpload(files);
  };

  const onDropFiles = (event: React.DragEvent) => {
    if (readOnly || busy || !onUpload) return;
    const files = collectStoryboardFrameImageFiles(event.dataTransfer);
    if (!files.length) return;
    event.preventDefault();
    event.stopPropagation();
    onUpload(files);
  };

  const onDragOverFiles = (event: React.DragEvent) => {
    if (readOnly || busy || !onUpload) return;
    if (event.dataTransfer.types.includes('Files')) {
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'copy';
    }
  };

  const pendingCount = sheetPreviews.filter((item) => item.genStatus === 'pending').length;
  const progressPct =
    progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div
      className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3"
      data-no-global-image-drop
      onDragOver={onDragOverFiles}
      onDrop={onDropFiles}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold text-gray-300">生成拼图</span>
        <span className="text-[9px] text-gray-500">
          {sheetPreviews.length > 0 ? `${sheetPreviews.length} 张` : '暂无'}
        </span>
      </div>

      {busy && progress ? (
        <div className="mb-2 space-y-1.5 rounded-lg bg-white/[0.03] px-2 py-1.5">
          <div className="flex items-center gap-2">
            <span className="inline-block h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
              <span
                className="block h-full rounded-full bg-gradient-to-r from-white/20 via-white/45 to-white/20 transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </span>
            <span className="shrink-0 text-[9px] text-gray-400">
              {progress.done}/{progress.total}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[9px] text-gray-500">
              {progressLabel} {progressPct}%
              {pendingCount > 0 ? ` · 排队 ${pendingCount}` : ''}
            </span>
            {!readOnly && onCancelGen && pendingCount > 0 ? (
              <button
                type="button"
                onClick={onCancelGen}
                className="shrink-0 rounded-md bg-white/[0.06] px-2 py-0.5 text-[9px] text-gray-300 transition-colors hover:bg-white/[0.1] hover:text-white"
              >
                取消排队
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={onFilePicked}
      />

      <div
        className={`grid max-h-[min(18rem,42vh)] grid-cols-5 ${STORYBOARD_GAP_TIGHT} overflow-y-auto overflow-x-hidden pb-0.5`}
      >
        {sheetPreviews.map((preview) => {
          const img = String(preview.imageDataUrl || '').trim();
          const splitBusy = sheetSplitBusyId === preview.id;
          const regenBusy = sheetRegenBusyId === preview.id;
          const cardBusy = splitBusy || regenBusy;
          const shotTotal = preview.shotNos.length || preview.rowIds.length;
          const shotLabel = formatSheetPreviewShotLabel(preview.shotNos);
          const generating = isPreviewGenerating(preview);
          const failed = preview.genStatus === 'failed';
          const cancelled = preview.genStatus === 'cancelled';
          const hasImage = previewHasImage(preview);
          const canPreview = hasImage && !generating && !failed && !cancelled;
          const splitDetecting = preview.splitDetectStatus === 'detecting';
          const splitDetectFailed = preview.splitDetectStatus === 'failed';
          const splitBoxCount = preview.splitDraftBoxes?.length ?? 0;
          const splitDetectReady = preview.splitDetectStatus === 'ready' && splitBoxCount > 0;

          return (
            <div key={preview.id} className={SHEET_PREVIEW_COL}>
              <div className={`group ${SHEET_PREVIEW_CARD}`}>
                {canPreview ? (
                  <button
                    type="button"
                    className="block h-full w-full"
                    onClick={() => onPreview(preview)}
                    disabled={cardBusy}
                  >
                    <img
                      src={img}
                      alt={preview.label}
                      className={SHEET_PREVIEW_IMG}
                      draggable={false}
                    />
                  </button>
                ) : generating ? (
                  <div className="relative flex h-full w-full flex-col items-center justify-center overflow-hidden bg-white/[0.03]">
                    <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-white/[0.04] via-white/[0.12] to-white/[0.04]" />
                    {hasImage ? (
                      <img
                        src={img}
                        alt=""
                        className={`absolute inset-0 ${SHEET_PREVIEW_IMG} opacity-35`}
                        draggable={false}
                      />
                    ) : null}
                    <span className="relative z-[1] text-[9px] text-gray-300">
                      {preview.genStatus === 'pending' ? '排队中' : '生成中…'}
                    </span>
                  </div>
                ) : failed ? (
                  <div
                    className="flex h-full w-full flex-col items-center justify-center gap-0.5 bg-red-500/[0.08] px-1 text-center"
                    title={preview.genError || '生成失败'}
                  >
                    <span className="text-[9px] text-red-300/90">失败</span>
                    <span className="line-clamp-2 text-[8px] text-red-200/60">
                      {preview.genError || '生图失败'}
                    </span>
                  </div>
                ) : cancelled ? (
                  <div className="flex h-full w-full items-center justify-center bg-white/[0.02] text-[9px] text-gray-600">
                    已取消
                  </div>
                ) : hasImage ? (
                  <button
                    type="button"
                    className="block h-full w-full"
                    onClick={() => onPreview(preview)}
                    disabled={cardBusy}
                  >
                    <img
                      src={img}
                      alt={preview.label}
                      className={SHEET_PREVIEW_IMG}
                      draggable={false}
                    />
                  </button>
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-white/[0.03] text-[9px] text-gray-600">
                    加载中…
                  </div>
                )}
                {cardBusy ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-[9px] text-gray-200">
                    {regenBusy ? '重生成…' : '切分中…'}
                  </div>
                ) : null}
                {splitDetectReady && !cardBusy ? (
                  <span
                    className="absolute left-1.5 top-1.5 z-10 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] text-emerald-200"
                    title={`已识别 ${splitBoxCount} 个分镜格`}
                  >
                    {splitBoxCount} 格
                  </span>
                ) : null}
                {splitDetecting && !cardBusy ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/45 text-[9px] text-gray-200">
                    识别中…
                  </div>
                ) : null}
                {splitDetectFailed && !cardBusy && !splitDetecting ? (
                  <div
                    className="absolute inset-0 flex items-center justify-center bg-amber-500/10 px-1 text-center text-[8px] text-amber-200/90"
                    title={preview.splitDetectError || '识别失败，可点切分手动框选'}
                  >
                    识别失败
                  </div>
                ) : null}
                {!readOnly && isGeneratedTaskTerminal(preview) ? (
                  <div className="absolute inset-x-0.5 bottom-4 flex items-center justify-center gap-1">
                    {onRegenerateSheet ? (
                      <button
                        type="button"
                        aria-label="重新生成"
                        disabled={busy || cardBusy}
                        onClick={(event) => {
                          event.stopPropagation();
                          onRegenerateSheet(preview.id);
                        }}
                        className="rounded-md bg-black/70 px-1.5 py-0.5 text-[8px] text-gray-100 transition-colors hover:bg-black/85 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        重试
                      </button>
                    ) : null}
                    {onDeleteSheet ? (
                      <button
                        type="button"
                        aria-label="删除任务"
                        disabled={busy || cardBusy}
                        onClick={(event) => {
                          event.stopPropagation();
                          onDeleteSheet(preview.id);
                        }}
                        className="rounded-md bg-black/70 px-1.5 py-0.5 text-[8px] text-gray-100 transition-colors hover:bg-black/85 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        删除
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {shotLabel ? (
                  <span className="pointer-events-none absolute bottom-0.5 left-0.5 rounded bg-black/60 px-1 py-0.5 text-[8px] text-gray-300">
                    {shotLabel}
                    {!generating && !cancelled && preview.matchedCount > 0 && shotTotal > 0
                      ? ` · ${preview.matchedCount}/${shotTotal}`
                      : ''}
                  </span>
                ) : shotTotal > 0 && !generating && !cancelled ? (
                  <span className="pointer-events-none absolute bottom-0.5 left-0.5 rounded bg-black/60 px-1 py-0.5 text-[8px] text-gray-300">
                    {preview.matchedCount}/{shotTotal}
                  </span>
                ) : null}
                {!readOnly && onSelectSheetVersion ? (
                  <StoryboardSheetPreviewVersionMenu
                    preview={preview}
                    disabled={busy || cardBusy}
                    onSelectVersion={onSelectSheetVersion}
                  />
                ) : null}
                {!readOnly && onApplySheet && canPreview ? (
                  <div className="absolute right-0.5 top-0.5 flex flex-col items-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      aria-label="切分回填"
                      disabled={busy || cardBusy}
                      onClick={(event) => {
                        event.stopPropagation();
                        onApplySheet(preview.id);
                      }}
                      className="rounded-md bg-black/55 px-1 py-0.5 text-[8px] text-gray-200 hover:text-white"
                    >
                      切分
                    </button>
                    {onRegenerateSheet && preview.source === 'generated' ? (
                      <button
                        type="button"
                        aria-label="重新生成"
                        disabled={busy || cardBusy}
                        onClick={(event) => {
                          event.stopPropagation();
                          onRegenerateSheet(preview.id);
                        }}
                        className="rounded-md bg-black/55 px-1 py-0.5 text-[8px] text-gray-200 hover:text-white"
                      >
                        重生成
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {!readOnly && onCancelGenTask && preview.genStatus === 'pending' ? (
                  <button
                    type="button"
                    aria-label="取消任务"
                    onClick={(event) => {
                      event.stopPropagation();
                      onCancelGenTask(preview.id);
                    }}
                    className="absolute right-0.5 top-0.5 rounded-md bg-black/55 p-0.5 text-gray-300 opacity-0 transition-opacity hover:text-white group-hover:opacity-100"
                  >
                    <AppIcon name="close" className="h-3 w-3" />
                  </button>
                ) : null}
                {!readOnly && onDeleteSheet && canShowSheetCornerDelete(preview) ? (
                  <button
                    type="button"
                    aria-label="删除拼图"
                    disabled={busy || cardBusy}
                    onClick={(event) => {
                      event.stopPropagation();
                      onDeleteSheet(preview.id);
                    }}
                    className="absolute bottom-0.5 right-0.5 rounded-md bg-black/55 p-0.5 text-gray-300 opacity-0 transition-opacity hover:text-white group-hover:opacity-100"
                  >
                    <AppIcon name="close" className="h-3 w-3" />
                  </button>
                ) : null}
              </div>
              <span
                className="truncate text-center text-[9px] text-gray-500"
                title={preview.label}
              >
                {preview.label}
              </span>
            </div>
          );
        })}

        {sheetPreviews.length === 0 && !busy ? (
          <div className={SHEET_PREVIEW_SLOT}>生成后显示</div>
        ) : null}

        {!readOnly && onUpload ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
            className={`${SHEET_PREVIEW_SLOT} flex-col gap-1 border-white/[0.12] bg-white/[0.02] text-gray-500 transition-colors hover:border-white/25 hover:bg-white/[0.04] hover:text-gray-300 disabled:cursor-not-allowed disabled:opacity-40`}
          >
            <AppIcon name="image" className="h-3.5 w-3.5 opacity-70" />
            <span>上传/拖入</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
