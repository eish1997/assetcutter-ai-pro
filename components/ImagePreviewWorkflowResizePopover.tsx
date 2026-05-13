import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { CustomDropdown } from './ui/CustomDropdown';
import type { ImagePreviewSplitStretchExportState } from './ImagePreviewSplitStretchOverlay';
import {
  canvasToPngDataUrl,
  computeUniformOutputSize,
  rasterizeFlatImageNatural,
  scaleCanvasToSize,
  type WorkflowLightboxImageWriteBackPayload,
  type WorkflowResizeMode,
} from '../services/imagePreviewWorkflowResize';

const RESIZE_MODE_OPTIONS: Array<{ value: WorkflowResizeMode; label: string; title: string }> = [
  { value: 'max_edge', label: '长边上限', title: '等比缩放，使较长边不超过设定值' },
  { value: 'width', label: '指定宽度', title: '等比缩放至目标宽度（高度按比例）' },
  { value: 'height', label: '指定高度', title: '等比缩放至目标高度（宽度按比例）' },
];

const PRESET_MAX_EDGES = [1024, 2048, 4096] as const;

export type ImagePreviewWorkflowResizePopoverProps = {
  open: boolean;
  onClose: () => void;
  /** 非平面时禁用提交 */
  flatActive: boolean;
  imgRef: React.RefObject<HTMLImageElement | null>;
  splitExportRef: React.MutableRefObject<ImagePreviewSplitStretchExportState | null>;
  onCommit: (payload: WorkflowLightboxImageWriteBackPayload) => void | Promise<void>;
};

export function ImagePreviewWorkflowResizePopover({
  open,
  onClose,
  flatActive,
  imgRef,
  splitExportRef,
  onCommit,
}: ImagePreviewWorkflowResizePopoverProps) {
  const [mode, setMode] = useState<WorkflowResizeMode>('max_edge');
  const [valueStr, setValueStr] = useState('2048');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setValueStr(mode === 'max_edge' ? '2048' : mode === 'width' ? '1920' : '1080');
  }, [open, mode]);

  const parsedValue = useMemo(() => {
    const n = Number(String(valueStr).trim());
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : NaN;
  }, [valueStr]);

  const handleCommit = useCallback(async () => {
    if (!flatActive || busy) return;
    const img = imgRef.current;
    if (!img?.complete || !img.naturalWidth) return;
    const v = parsedValue;
    if (!Number.isFinite(v) || v < 1) return;
    const raw = splitExportRef.current;
    const split = raw?.active ? raw : null;
    const natural = rasterizeFlatImageNatural(img, split);
    if (!natural) return;
    const sz = computeUniformOutputSize(natural.width, natural.height, mode, v);
    if (!sz) return;
    if (sz.w === natural.width && sz.h === natural.height) {
      const dataUrl = canvasToPngDataUrl(natural);
      if (!dataUrl) return;
      setBusy(true);
      try {
        await Promise.resolve(
          onCommit({ dataUrl, width: sz.w, height: sz.h, writeBackKind: 'resize' })
        );
        onClose();
      } finally {
        setBusy(false);
      }
      return;
    }
    const scaled = scaleCanvasToSize(natural, sz.w, sz.h);
    const dataUrl = canvasToPngDataUrl(scaled);
    if (!dataUrl) return;
    setBusy(true);
    try {
      await Promise.resolve(
        onCommit({ dataUrl, width: sz.w, height: sz.h, writeBackKind: 'resize' })
      );
      onClose();
    } finally {
      setBusy(false);
    }
  }, [flatActive, busy, imgRef, parsedValue, mode, onCommit, onClose, splitExportRef]);

  if (!open || typeof document === 'undefined') return null;

  const disabled = !flatActive;
  const valueOk = Number.isFinite(parsedValue) && parsedValue >= 1 && parsedValue <= 8192;

  return createPortal(
    <div
      className="fixed z-[2702] w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-white/[0.12] bg-[#0c0c10]/95 p-3 shadow-2xl backdrop-blur-xl ring-1 ring-inset ring-white/[0.06]"
      style={{ top: 'max(4.5rem, env(safe-area-inset-top, 0px))', right: 'max(1rem, env(safe-area-inset-right, 0px))' }}
      role="dialog"
      aria-label="改尺寸写回"
      data-image-preview-no-wheel=""
    >
      <div className="text-[11px] font-semibold text-white/90">改尺寸写回资产</div>
      <p className="mt-1 text-[10px] leading-relaxed text-gray-500">
        等比缩放当前平面预览（含线分割变形）；写回后清除本版本平面/全景标注以免错位。
      </p>
      <div className="mt-2 space-y-2">
        <div>
          <div className="mb-1 text-[9px] uppercase tracking-wide text-gray-500">方式</div>
          <CustomDropdown
            value={mode}
            onChange={(v) => setMode(v as WorkflowResizeMode)}
            options={RESIZE_MODE_OPTIONS}
            listDensity="compact"
            listClassName="border border-white/[0.12] bg-[#0c0c10]/95 backdrop-blur-xl shadow-[0_12px_36px_rgba(0,0,0,0.5)] ring-1 ring-inset ring-white/[0.06]"
            triggerAriaLabel="缩放方式"
            triggerClassName="h-8 w-full justify-between rounded-lg bg-white/5 px-2 text-left text-[11px] text-gray-200 ring-1 ring-inset ring-white/[0.08] hover:bg-white/[0.08]"
            portalZIndex={{ backdrop: 2703, list: 2704 }}
          />
        </div>
        <label className="block">
          <span className="mb-1 block text-[9px] uppercase tracking-wide text-gray-500">
            {mode === 'max_edge' ? '长边像素（1～8192）' : mode === 'width' ? '宽度像素' : '高度像素'}
          </span>
          <input
            type="number"
            min={1}
            max={8192}
            value={valueStr}
            onChange={(e) => setValueStr(e.target.value)}
            disabled={disabled}
            className="w-full rounded-lg bg-white/[0.06] px-2 py-1.5 text-[12px] text-white outline-none ring-1 ring-inset ring-white/[0.1] focus-visible:ring-2 focus-visible:ring-blue-500/50 disabled:opacity-45"
          />
        </label>
        {mode === 'max_edge' ? (
          <div className="flex flex-wrap gap-1">
            {PRESET_MAX_EDGES.map((n) => (
              <button
                key={n}
                type="button"
                disabled={disabled}
                onClick={() => setValueStr(String(n))}
                className="rounded-md bg-white/[0.06] px-2 py-1 text-[10px] text-gray-300 hover:bg-white/10 disabled:opacity-45"
              >
                {n}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {disabled ? (
        <p className="mt-2 text-[10px] text-amber-200/90">请切换到「平面」预览后再写回。</p>
      ) : null}
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-3 py-1.5 text-[11px] text-gray-300 hover:bg-white/[0.06]"
        >
          取消
        </button>
        <button
          type="button"
          disabled={disabled || !valueOk || busy}
          onClick={() => void handleCommit()}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-blue-500 disabled:opacity-40"
        >
          {busy ? '处理中…' : '写回'}
        </button>
      </div>
    </div>,
    document.body
  );
}
