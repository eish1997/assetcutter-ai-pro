import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  formatSheetPreviewShotLabel,
  parseSheetPreviewShotRange,
} from '../../services/storyboardSheetPreview';
import {
  STORYBOARD_FIELD_INPUT,
  STORYBOARD_TOOL_BTN_NEUTRAL,
  STORYBOARD_TOOL_BTN_PRIMARY,
} from './storyboardTableUi';
import AppIcon from '../ui/AppIcon';

type Props = {
  open: boolean;
  busy?: boolean;
  previewSrc?: string | null;
  defaultFrom?: string;
  defaultTo?: string;
  title?: string;
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: (range: { shotFrom: string; shotTo: string }) => void;
};

export default function StoryboardSheetUploadModal({
  open,
  busy = false,
  previewSrc = null,
  defaultFrom = '01',
  defaultTo = '01',
  title = '上传拼图',
  confirmLabel = '加入预览',
  onClose,
  onConfirm,
}: Props) {
  const [shotFrom, setShotFrom] = useState(defaultFrom);
  const [shotTo, setShotTo] = useState(defaultTo);

  useEffect(() => {
    if (!open) return;
    setShotFrom(defaultFrom);
    setShotTo(defaultTo);
  }, [defaultFrom, defaultTo, open]);

  const parsed = useMemo(
    () => parseSheetPreviewShotRange(shotFrom, shotTo),
    [shotFrom, shotTo]
  );
  const shotLabel = parsed.ok ? formatSheetPreviewShotLabel(parsed.shotNos) : '';

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
            <p className="mb-2 text-[11px] text-gray-400">填写拼图包含的镜号范围，切分时会回填到对应镜头；缺失镜头会自动新建。</p>
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <label className="space-y-1">
                <span className="text-[10px] text-gray-500">从</span>
                <input
                  value={shotFrom}
                  onChange={(event) => setShotFrom(event.target.value)}
                  disabled={busy}
                  placeholder="01"
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
            disabled={busy || !parsed.ok}
            onClick={() => onConfirm({ shotFrom: shotFrom.trim(), shotTo: shotTo.trim() })}
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
