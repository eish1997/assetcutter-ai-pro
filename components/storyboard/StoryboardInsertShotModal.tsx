import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { StoryboardTableRow } from '../../types';
import {
  computeDefaultInsertShotNo,
  computeInsertShotPickerRange,
  normalizeInsertShotCount,
  planInsertShotsWithShift,
} from '../../services/storyboardInsertShot';
import { normalizeStoryboardShotNoInput, formatStoryboardNumericShotNo } from '../../services/storyboardTableParse';
import {
  STORYBOARD_FIELD_INPUT,
  STORYBOARD_LABEL,
  STORYBOARD_TOOL_BTN_NEUTRAL,
  STORYBOARD_TOOL_BTN_PRIMARY,
} from './storyboardTableUi';
import StoryboardInsertShotPreview from './StoryboardInsertShotPreview';
import AppIcon from '../ui/AppIcon';

type Props = {
  open: boolean;
  rows: StoryboardTableRow[];
  busy?: boolean;
  initialShotNo?: string | null;
  onClose: () => void;
  onConfirm: (payload: { newRows: StoryboardTableRow[]; nextRows: StoryboardTableRow[] }) => void;
};

export default function StoryboardInsertShotModal({
  open,
  rows,
  busy = false,
  initialShotNo = null,
  onClose,
  onConfirm,
}: Props) {
  const defaultShotNo = useMemo(() => computeDefaultInsertShotNo(rows), [rows]);
  const [shotNoInput, setShotNoInput] = useState(defaultShotNo);
  const [insertCountInput, setInsertCountInput] = useState('1');
  const backdropPointerDownRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    const nextShotNo = initialShotNo?.trim() || defaultShotNo;
    setShotNoInput(nextShotNo);
    setInsertCountInput('1');
  }, [defaultShotNo, initialShotNo, open]);

  const insertCount = useMemo(() => normalizeInsertShotCount(insertCountInput), [insertCountInput]);
  const pickerRange = useMemo(() => computeInsertShotPickerRange(rows), [rows]);

  const plan = useMemo(
    () => planInsertShotsWithShift(rows, shotNoInput, insertCount),
    [insertCount, rows, shotNoInput]
  );

  const handleConfirm = useCallback(() => {
    if (!plan.ok || busy) return;
    onConfirm({ newRows: plan.newRows, nextRows: plan.nextRows });
  }, [busy, onConfirm, plan]);

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

  useEffect(() => {
    if (!open) return;
    const resetBackdropPointer = () => {
      backdropPointerDownRef.current = false;
    };
    window.addEventListener('mouseup', resetBackdropPointer);
    return () => window.removeEventListener('mouseup', resetBackdropPointer);
  }, [open]);

  const onBlurNormalize = useCallback(() => {
    const normalized = normalizeStoryboardShotNoInput(shotNoInput);
    if (normalized && normalized !== shotNoInput.trim()) {
      setShotNoInput(normalized);
    }
  }, [shotNoInput]);

  if (!open || typeof document === 'undefined') return null;

  const hasNonNumericRows = rows.some((row) => {
    const trimmed = String(row.shotNo ?? '').trim();
    if (!trimmed) return false;
    const normalized = normalizeStoryboardShotNoInput(trimmed);
    return !normalized || !/^\d+$/.test(normalized);
  });

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[2175] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
        onMouseDown={(event) => {
          backdropPointerDownRef.current = event.target === event.currentTarget;
        }}
        onMouseUp={(event) => {
          if (backdropPointerDownRef.current && event.target === event.currentTarget && !busy) {
            onClose();
          }
          backdropPointerDownRef.current = false;
        }}
        role="presentation"
      >
        <div
          className="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0a0a0e]/95 shadow-2xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="storyboard-insert-shot-title"
          {...(!plan.ok ? { 'aria-describedby': 'storyboard-insert-shot-summary' } : {})}
        >
          <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3">
            <h2 id="storyboard-insert-shot-title" className="text-sm font-semibold text-white">
              插入镜头
            </h2>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-md p-1 text-gray-400 transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-40"
              aria-label="关闭"
            >
              <AppIcon name="close" className="h-4 w-4" />
            </button>
          </div>

          <div className="flex flex-col gap-3 px-4 py-4">
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className={STORYBOARD_LABEL}>起始镜号</span>
                <input
                  value={shotNoInput}
                  disabled={busy}
                  onChange={(event) => setShotNoInput(event.target.value)}
                  onBlur={onBlurNormalize}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && plan.ok && !busy) {
                      event.preventDefault();
                      handleConfirm();
                    }
                  }}
                  className={STORYBOARD_FIELD_INPUT}
                  placeholder="例如 050"
                  autoFocus
                />
              </label>
              <label className="block">
                <span className={STORYBOARD_LABEL}>插入数量</span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  step={1}
                  value={insertCountInput}
                  disabled={busy}
                  onChange={(event) => setInsertCountInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && plan.ok && !busy) {
                      event.preventDefault();
                      handleConfirm();
                    }
                  }}
                  className={STORYBOARD_FIELD_INPUT}
                  placeholder="1"
                />
              </label>
            </div>

            <StoryboardInsertShotPreview
              rows={rows}
              insertCount={insertCount}
              preview={plan.ok ? plan.preview : null}
              insertNumeric={plan.ok ? plan.insertNumeric : null}
              pickerMin={pickerRange.min}
              pickerMax={pickerRange.max}
              disabled={busy}
              onInsertNumericChange={(numeric) =>
                setShotNoInput(formatStoryboardNumericShotNo(String(numeric)))
              }
            />

            {!plan.ok ? (
              <p
                id="storyboard-insert-shot-summary"
                aria-live="polite"
                className="text-[11px] leading-relaxed text-amber-200/90"
              >
                {plan.message}
              </p>
            ) : null}

            {hasNonNumericRows ? (
              <p className="text-[10px] leading-relaxed text-gray-600">
                非数字镜号（如 SC01）不会自动变更。
              </p>
            ) : null}
          </div>

          <div className="flex justify-end gap-2 border-t border-white/[0.08] px-4 py-3">
            <button type="button" onClick={onClose} disabled={busy} className={STORYBOARD_TOOL_BTN_NEUTRAL}>
              取消
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!plan.ok || busy}
              className={STORYBOARD_TOOL_BTN_PRIMARY}
            >
              {busy ? '插入中…' : plan.ok && plan.insertCount > 1 ? `插入 ${plan.insertCount} 镜` : '插入'}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
