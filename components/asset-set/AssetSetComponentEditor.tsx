import React from 'react';
import type { AssetSetComponent } from '../../types';
import { useDebouncedLocalText } from '../../hooks/useDebouncedLocalText';
import {
  resolveAssetSetComponentCropSrc,
  resolveAssetSetComponentMultiviewSheetSrc,
  resolveAssetSetComponentViewSrc,
} from '../../services/assetSet/assetSetAsset';
import { STORYBOARD_FIELD_INPUT, ASSET_SET_THUMB } from './assetSetPanelUi';

type Props = {
  component: AssetSetComponent;
  readOnly?: boolean;
  onRename: (name: string) => void;
  onToggleLock: (locked: boolean) => void;
  onPreviewImage?: (src: string) => void;
  onRetry3d?: () => void;
  retry3dBusy?: boolean;
  onRegenerateFromCrop?: () => void;
  regenerateCropBusy?: boolean;
  cropRegenPresetLabel?: string;
};

export default function AssetSetComponentEditor({
  component,
  readOnly = false,
  onRename,
  onToggleLock,
  onPreviewImage,
  onRetry3d,
  retry3dBusy = false,
  onRegenerateFromCrop,
  regenerateCropBusy = false,
  cropRegenPresetLabel,
}: Props) {
  const cropSrc = resolveAssetSetComponentCropSrc(component);
  const sheetSrc = resolveAssetSetComponentMultiviewSheetSrc(component);
  const model = component.model3d;
  const nameField = useDebouncedLocalText(component.name || '', onRename);

  return (
    <div className="space-y-3 px-0.5">
      <div>
        <p className="mb-1 text-[10px] font-semibold text-gray-300">组件名</p>
        <input
          type="text"
          value={nameField.draft}
          disabled={readOnly}
          onChange={(e) => nameField.onChange(e.target.value)}
          onBlur={nameField.onBlur}
          className={STORYBOARD_FIELD_INPUT}
          placeholder="组件 01"
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-1.5 text-[10px] text-gray-400">
          <input
            type="checkbox"
            checked={Boolean(component.locked)}
            disabled={readOnly}
            onChange={(e) => onToggleLock(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-white/20 bg-white/5"
          />
          锁定（跳过批量）
        </label>
      </div>

      {cropSrc ? (
        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <p className="text-[10px] font-semibold text-gray-300">裁切预览</p>
            {!readOnly && onRegenerateFromCrop ? (
              <button
                type="button"
                disabled={regenerateCropBusy}
                onClick={onRegenerateFromCrop}
                className="rounded-md bg-white/5 px-1.5 py-0.5 text-[9px] text-cyan-200 ring-1 ring-cyan-400/25 disabled:opacity-40"
                title={cropRegenPresetLabel ? `预设：${cropRegenPresetLabel}` : undefined}
              >
                {regenerateCropBusy ? '生成中…' : '用裁切再生成'}
              </button>
            ) : null}
          </div>
          <button
            type="button"
            className="block w-full overflow-hidden rounded-lg ring-1 ring-white/10"
            onClick={() => onPreviewImage?.(cropSrc)}
          >
            <img
              src={cropSrc}
              alt=""
              className={`${ASSET_SET_THUMB} object-cover`}
              loading="lazy"
              decoding="async"
            />
          </button>
        </div>
      ) : null}

      {sheetSrc ? (
        <div>
          <p className="mb-1 text-[10px] font-semibold text-gray-300">多视角拼图</p>
          <button
            type="button"
            className="block w-full overflow-hidden rounded-lg ring-1 ring-white/10"
            onClick={() => onPreviewImage?.(sheetSrc)}
          >
            <img src={sheetSrc} alt="" className={ASSET_SET_THUMB} loading="lazy" decoding="async" />
          </button>
        </div>
      ) : null}

      {component.views.length > 0 ? (
        <div>
          <p className="mb-1 text-[10px] font-semibold text-gray-300">
            视角图 ({component.views.filter((v) => resolveAssetSetComponentViewSrc(v)).length})
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {component.views.map((view) => {
              const src = resolveAssetSetComponentViewSrc(view);
              if (!src) return null;
              return (
                <button
                  key={view.id}
                  type="button"
                  className="overflow-hidden rounded-md ring-1 ring-white/10"
                  onClick={() => onPreviewImage?.(src)}
                >
                  <img
                    src={src}
                    alt=""
                    className="aspect-square w-full object-cover"
                    loading="lazy"
                    decoding="async"
                  />
                  <span className="block bg-black/50 px-1 py-0.5 text-center text-[8px] text-gray-300">
                    {view.role}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {model && model.status !== 'idle' ? (
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2 text-[10px] text-gray-300">
          <p className="font-semibold text-gray-200">3D 状态</p>
          <p className="mt-1 capitalize">{model.status}</p>
          {model.error ? <p className="mt-1 text-red-300/90">{model.error}</p> : null}
          {model.status === 'failed' && !readOnly && onRetry3d ? (
            <button
              type="button"
              disabled={retry3dBusy}
              onClick={onRetry3d}
              className="mt-2 rounded-lg bg-cyan-500/15 px-2 py-1 text-[10px] font-semibold text-cyan-100 ring-1 ring-cyan-400/30 disabled:opacity-40"
            >
              {retry3dBusy ? '重试中…' : '重试 3D'}
            </button>
          ) : null}
          {model.previewUrl ? (
            <button
              type="button"
              className="mt-2 block w-full overflow-hidden rounded-md"
              onClick={() => onPreviewImage?.(model.previewUrl!)}
            >
              <img
                src={model.previewUrl}
                alt=""
                className="aspect-square w-full max-h-32 object-cover"
              />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
