import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  formatSheetPreviewShotLabel,
  parseSheetPreviewShotRange,
} from '../../services/storyboardSheetPreview';
import {
  parseStoryboardSheetLayoutGrid,
  suggestStoryboardSheetLayoutGrid,
} from '../../services/storyboardSheetVisionSplit';
import {
  STORYBOARD_FIELD_INPUT,
  STORYBOARD_TOOL_BTN_NEUTRAL,
  STORYBOARD_TOOL_BTN_PRIMARY,
} from './storyboardTableUi';
import AppIcon from '../ui/AppIcon';

export type StoryboardSheetUploadConfirmPayload = {
  shotFrom: string;
  shotTo: string;
  layoutCols?: number;
  layoutRows?: number;
};

type Props = {
  open: boolean;
  busy?: boolean;
  previewSrc?: string | null;
  defaultFrom?: string;
  defaultTo?: string;
  defaultLayoutCols?: number;
  defaultLayoutRows?: number;
  title?: string;
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: (payload: StoryboardSheetUploadConfirmPayload) => void;
};

export default function StoryboardSheetUploadModal({
  open,
  busy = false,
  previewSrc = null,
  defaultFrom = '001',
  defaultTo = '001',
  defaultLayoutCols,
  defaultLayoutRows,
  title = '上传拼图',
  confirmLabel = '加入预览',
  onClose,
  onConfirm,
}: Props) {
  const [shotFrom, setShotFrom] = useState(defaultFrom);
  const [shotTo, setShotTo] = useState(defaultTo);
  const [layoutCols, setLayoutCols] = useState(
    defaultLayoutCols != null ? String(defaultLayoutCols) : ''
  );
  const [layoutRows, setLayoutRows] = useState(
    defaultLayoutRows != null ? String(defaultLayoutRows) : ''
  );

  useEffect(() => {
    if (!open) return;
    setShotFrom(defaultFrom);
    setShotTo(defaultTo);
    setLayoutCols(defaultLayoutCols != null ? String(defaultLayoutCols) : '');
    setLayoutRows(defaultLayoutRows != null ? String(defaultLayoutRows) : '');
  }, [defaultFrom, defaultTo, defaultLayoutCols, defaultLayoutRows, open]);

  const parsed = useMemo(
    () => parseSheetPreviewShotRange(shotFrom, shotTo),
    [shotFrom, shotTo]
  );
  const shotLabel = parsed.ok ? formatSheetPreviewShotLabel(parsed.shotNos) : '';
  const suggestedLayout = parsed.ok
    ? suggestStoryboardSheetLayoutGrid(parsed.shotNos.length)
    : null;
  const layoutParsed = useMemo(() => {
    if (!parsed.ok) return null;
    if (!layoutCols.trim() && !layoutRows.trim()) return { ok: true as const, layout: undefined };
    return parseStoryboardSheetLayoutGrid(layoutCols, layoutRows, parsed.shotNos.length);
  }, [layoutCols, layoutRows, parsed]);

  const canConfirm = parsed.ok && (layoutParsed == null || layoutParsed.ok);

  const onEscape = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    },
    [busy, onClose]
  );

  useEffect(() => {
    if (!open) return;
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [open, onEscape]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[2175] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={() => {
        if (!busy) onClose();
      }}
      role="presentation"
    >
      <div
        className="flex w-full max-w-md flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0a0a0e]/95 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="storyboard-sheet-upload-title"
      >
        <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3">
          <h2 id="storyboard-sheet-upload-title" className="text-sm font-semibold text-white">
            {title}
          </h2>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-md p-1 text-gray-400 transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-40"
            aria-label="关闭"
          >
            <AppIcon name="close" className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-4 py-4">
          {previewSrc ? (
            <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-black/30">
              <img
                src={previewSrc}
                alt="拼图预览"
                className="max-h-40 w-full object-contain"
                draggable={false}
              />
            </div>
          ) : null}

          <div>
            <p className="mb-2 text-[11px] text-gray-400">
              填写拼图包含的镜号范围；切分时优先 AI 识别每格，未识别到的镜头不会用盲目网格硬切（除非填写下方行列布局）。
            </p>
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <label className="space-y-1">
                <span className="text-[10px] text-gray-500">从</span>
                <input
                  value={shotFrom}
                  onChange={(event) => setShotFrom(event.target.value)}
                  disabled={busy}
                  placeholder="001"
                  className={STORYBOARD_FIELD_INPUT}
                />
              </label>
              <span className="pt-4 text-[11px] text-gray-500">到</span>
              <label className="space-y-1">
                <span className="text-[10px] text-gray-500">到</span>
                <input
                  value={shotTo}
                  onChange={(event) => setShotTo(event.target.value)}
                  disabled={busy}
                  placeholder="06"
                  className={STORYBOARD_FIELD_INPUT}
                />
              </label>
            </div>
            {parsed.ok ? (
              <p className="mt-2 text-[10px] text-gray-500">将覆盖 {shotLabel}，共 {parsed.shotNos.length} 镜</p>
            ) : (
              <p className="mt-2 text-[10px] text-red-300/80">{parsed.error}</p>
            )}
          </div>

          <div>
            <p className="mb-2 text-[11px] text-gray-400">
              可选：填写拼图列×行（从左到右、从上到下对应镜号顺序）。AI 识别不全时，仅对已填布局做网格回填。
              {suggestedLayout
                ? ` 参考建议：${suggestedLayout.cols} 列 × ${suggestedLayout.rows} 行。`
                : ''}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <span className="text-[10px] text-gray-500">列数</span>
                <input
                  value={layoutCols}
                  onChange={(event) => setLayoutCols(event.target.value)}
                  disabled={busy}
                  placeholder={suggestedLayout ? String(suggestedLayout.cols) : '留空'}
                  className={STORYBOARD_FIELD_INPUT}
                />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] text-gray-500">行数</span>
                <input
                  value={layoutRows}
                  onChange={(event) => setLayoutRows(event.target.value)}
                  disabled={busy}
                  placeholder={suggestedLayout ? String(suggestedLayout.rows) : '留空'}
                  className={STORYBOARD_FIELD_INPUT}
                />
              </label>
            </div>
            {layoutParsed && !layoutParsed.ok ? (
              <p className="mt-2 text-[10px] text-red-300/80">{layoutParsed.error}</p>
            ) : null}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-white/[0.08] px-4 py-3">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className={STORYBOARD_TOOL_BTN_NEUTRAL}
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy || !canConfirm}
            onClick={() => {
              if (!parsed.ok) return;
              const payload: StoryboardSheetUploadConfirmPayload = {
                shotFrom: shotFrom.trim(),
                shotTo: shotTo.trim(),
              };
              if (layoutParsed?.ok && layoutParsed.layout) {
                payload.layoutCols = layoutParsed.layout.cols;
                payload.layoutRows = layoutParsed.layout.rows;
              }
              onConfirm(payload);
            }}
            className={STORYBOARD_TOOL_BTN_PRIMARY}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
