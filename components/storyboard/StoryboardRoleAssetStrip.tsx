import React, { useRef } from 'react';
import { collectStoryboardFrameImageFiles } from '../../services/storyboardTableFrameImport';
import {
  collectStoryboardFrameImageInputs,
  storyboardFrameImageDropAllowed,
} from '../../services/storyboardFrameDrag';
import { resolveStoryboardRoleAssetDisplaySrc } from '../../services/storyboardRoleAssets';
import AppIcon from '../ui/AppIcon';
import {
  STORYBOARD_FIELD_INPUT,
  STORYBOARD_GAP_TIGHT,
} from './storyboardTableUi';

type Props = {
  assets: Array<{ id: string; name: string; image?: string }>;
  readOnly?: boolean;
  busyId?: string | null;
  namePlaceholder?: string;
  addLabel?: string;
  removeAriaLabel?: string;
  resolveDisplaySrc?: (asset: { id: string; name: string; image?: string }) => string;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onAssignImage: (id: string, file: File) => void;
  onAssignImages?: (startAssetId: string | null, files: File[]) => void;
  onClearImage: (id: string) => void;
  onPreviewImage?: (src: string) => void;
  onAssetImageClick?: (asset: { id: string; name: string; image?: string }) => boolean;
};

function allowImageDrop(event: React.DragEvent) {
  if (!storyboardFrameImageDropAllowed(event.dataTransfer)) return;
  event.preventDefault();
  event.stopPropagation();
  event.dataTransfer.dropEffect = 'copy';
}

export default function StoryboardRoleAssetStrip({
  assets,
  readOnly = false,
  busyId = null,
  namePlaceholder = '角色名',
  addLabel = '添加角色',
  removeAriaLabel = '删除角色',
  resolveDisplaySrc = resolveStoryboardRoleAssetDisplaySrc,
  onAdd,
  onRemove,
  onRename,
  onAssignImage,
  onAssignImages,
  onClearImage,
  onPreviewImage,
  onAssetImageClick,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingIdRef = useRef<string | null>(null);

  const openPicker = (id: string) => {
    if (readOnly || busyId) return;
    pendingIdRef.current = id;
    fileInputRef.current?.click();
  };

  const onFilePicked = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = collectStoryboardFrameImageFiles(event.target.files);
    event.target.value = '';
    const id = pendingIdRef.current;
    pendingIdRef.current = null;
    if (!files.length || !id) return;
    if (files.length === 1) {
      onAssignImage(id, files[0]!);
      return;
    }
    if (onAssignImages) {
      onAssignImages(id, files);
      return;
    }
    onAssignImage(id, files[0]!);
  };

  const handleDrop = (startAssetId: string | null, event: React.DragEvent) => {
    if (readOnly || busyId) return;
    if (!storyboardFrameImageDropAllowed(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    void (async () => {
      const files = await collectStoryboardFrameImageInputs(event.dataTransfer);
      if (!files.length) return;
      if (files.length === 1 && startAssetId) {
        onAssignImage(startAssetId, files[0]!);
        return;
      }
      if (onAssignImages) {
        onAssignImages(startAssetId, files);
        return;
      }
      if (startAssetId) onAssignImage(startAssetId, files[0]!);
    })();
  };

  return (
    <div
      className="min-w-0"
      data-no-global-image-drop
      onDragOver={readOnly ? undefined : allowImageDrop}
      onDrop={readOnly ? undefined : (event) => handleDrop(null, event)}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={onFilePicked}
      />
      <div className={`flex items-start ${STORYBOARD_GAP_TIGHT} overflow-x-auto pb-0.5 no-scrollbar`}>
        {assets.map((asset) => {
          const img = resolveDisplaySrc(asset);
          const busy = busyId === asset.id;
          return (
            <div key={asset.id} className="flex w-[4.75rem] shrink-0 flex-col gap-1">
              <div
                className="group relative aspect-square w-full overflow-hidden rounded-xl ring-1 ring-white/[0.08]"
                onDragOver={readOnly || busy ? undefined : allowImageDrop}
                onDrop={readOnly || busy ? undefined : (event) => handleDrop(asset.id, event)}
              >
                {img ? (
                  <button
                    type="button"
                    className="block h-full w-full"
                    onClick={() => {
                      if (onAssetImageClick?.(asset)) return;
                      if (onPreviewImage) onPreviewImage(img);
                      else openPicker(asset.id);
                    }}
                    disabled={readOnly || busy}
                  >
                    <img
                      src={img}
                      alt=""
                      className="h-full w-full object-cover bg-black/20"
                      draggable={false}
                    />
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={readOnly || busy}
                    onClick={() => openPicker(asset.id)}
                    className="flex h-full w-full flex-col items-center justify-center gap-0.5 bg-white/[0.03] text-[9px] text-gray-500 transition-colors hover:bg-white/[0.06] hover:text-gray-300 disabled:cursor-not-allowed"
                  >
                    <AppIcon name="image" className="h-3.5 w-3.5 opacity-70" />
                    {busy ? '处理中…' : '点击或拖入'}
                  </button>
                )}
                {busy ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/45 text-[9px] text-gray-300">
                    压缩中…
                  </div>
                ) : null}
                {!readOnly && assets.length > 1 ? (
                  <button
                    type="button"
                    aria-label={removeAriaLabel}
                    onClick={() => onRemove(asset.id)}
                    className="absolute right-0.5 top-0.5 rounded-md bg-black/55 p-0.5 text-gray-300 opacity-0 transition-opacity hover:text-white group-hover:opacity-100"
                  >
                    <AppIcon name="close" className="h-3 w-3" />
                  </button>
                ) : null}
                {!readOnly && img ? (
                  <button
                    type="button"
                    aria-label="清除图片"
                    onClick={() => onClearImage(asset.id)}
                    className="absolute bottom-0.5 right-0.5 rounded-md bg-black/55 px-1 py-0.5 text-[8px] text-gray-300 opacity-0 transition-opacity hover:text-white group-hover:opacity-100"
                  >
                    清除
                  </button>
                ) : null}
              </div>
              <input
                value={asset.name}
                readOnly={readOnly}
                onChange={(event) => onRename(asset.id, event.target.value)}
                placeholder={namePlaceholder}
                className={`${STORYBOARD_FIELD_INPUT} h-7 px-1.5 text-center text-[9px]`}
              />
            </div>
          );
        })}
        {!readOnly ? (
          <button
            type="button"
            onClick={onAdd}
            className="flex h-[4.75rem] w-[4.75rem] shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-white/[0.12] bg-white/[0.02] text-[9px] text-gray-500 transition-colors hover:border-white/25 hover:bg-white/[0.04] hover:text-gray-300"
          >
            <span className="text-base leading-none text-white/60">+</span>
            <span>{addLabel}</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
