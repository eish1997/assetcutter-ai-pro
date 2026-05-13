import React, { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ImagePreviewSplitStretchExportState } from './ImagePreviewSplitStretchOverlay';
import {
  canvasToPngDataUrl,
  rasterizeFlatImageNatural,
  type WorkflowLightboxImageWriteBackPayload,
} from '../services/imagePreviewWorkflowResize';

export type ImagePreviewSplitStretchWriteBackPopoverProps = {
  open: boolean;
  onClose: () => void;
  flatActive: boolean;
  imgRef: React.RefObject<HTMLImageElement | null>;
  splitExportRef: React.MutableRefObject<ImagePreviewSplitStretchExportState | null>;
  onCommit: (payload: WorkflowLightboxImageWriteBackPayload) => void | Promise<void>;
};

/**
 * 线分割变形：仅写回当前变形（像素尺寸与源图一致），与「改尺寸写回」共用 onCommit；
 * 写回后在资产上追加新步骤（不覆盖当前显示版本键位）。
 */
export function ImagePreviewSplitStretchWriteBackPopover({
  open,
  onClose,
  flatActive,
  imgRef,
  splitExportRef,
  onCommit,
}: ImagePreviewSplitStretchWriteBackPopoverProps) {
  const [busy, setBusy] = useState(false);

  const handleCommit = useCallback(async () => {
    if (!flatActive || busy) return;
    const img = imgRef.current;
    if (!img?.complete || !img.naturalWidth) return;
    const raw = splitExportRef.current;
    const split = raw?.active ? raw : null;
    if (!split) return;
    const natural = rasterizeFlatImageNatural(img, split);
    if (!natural) return;
    const dataUrl = canvasToPngDataUrl(natural);
    if (!dataUrl) return;
    setBusy(true);
    try {
      await Promise.resolve(
        onCommit({ dataUrl, width: natural.width, height: natural.height, writeBackKind: 'split_stretch' })
      );
      onClose();
    } finally {
      setBusy(false);
    }
  }, [flatActive, busy, imgRef, splitExportRef, onCommit, onClose]);

  if (!open || typeof document === 'undefined') return null;

  const disabled = !flatActive;
  const splitOk = Boolean(splitExportRef.current?.active);

  return createPortal(
    <div
      className="fixed z-[2702] w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-white/[0.12] bg-[#0c0c10]/95 p-3 shadow-2xl backdrop-blur-xl ring-1 ring-inset ring-white/[0.06]"
      style={{ top: 'max(4.5rem, env(safe-area-inset-top, 0px))', right: 'max(1rem, env(safe-area-inset-right, 0px))' }}
      role="dialog"
      aria-label="线分割写回"
      data-image-preview-no-wheel=""
    >
      <div className="text-[11px] font-semibold text-white/90">线分割写回资产</div>
      <p className="mt-1 text-[10px] leading-relaxed text-gray-500">
        将当前分割线上下纵向变形写入当前显示版本，分辨率与源图一致；写回后清除本版本平面/全景标注以免错位。
      </p>
      {disabled ? (
        <p className="mt-2 text-[10px] text-amber-200/90">请切换到「平面」预览后再写回。</p>
      ) : !splitOk ? (
        <p className="mt-2 text-[10px] text-amber-200/90">线分割状态异常，请关闭线分割后重新开启再试。</p>
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
          disabled={disabled || !splitOk || busy}
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
