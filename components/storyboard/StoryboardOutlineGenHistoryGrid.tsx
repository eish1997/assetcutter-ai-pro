import React from 'react';
import type { StoryboardGeneratedAssetItem } from '../../services/storyboardGeneratedAssets';
import {
  writeStoryboardFrameAssetDragData,
  type StoryboardFrameAssetDragPayload,
} from '../../services/storyboardFrameDrag';
import { storyboardFrameVersionLabel } from '../../services/storyboardFrameHistory';

type Props = {
  assets: StoryboardGeneratedAssetItem[];
  onPreview?: (src: string, label: string) => void;
  onImageLoadError?: () => void;
};

function formatAssetTime(createdAt: number): string {
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function StoryboardOutlineGenHistoryGrid({ assets, onPreview, onImageLoadError }: Props) {
  if (!assets.length) {
    return (
      <p className="rounded-xl border border-dashed border-white/[0.08] px-3 py-8 text-center text-[10px] leading-relaxed text-gray-500">
        暂无生图记录
        <br />
        重绘、拼图生图或切分回填后会出现在这里
      </p>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-1.5 p-0.5">
      {assets.map((asset, indexFromNewest) => (
        <StoryboardOutlineGenHistoryTile
          key={asset.id}
          asset={asset}
          indexFromNewest={indexFromNewest}
          onPreview={onPreview}
          onImageLoadError={onImageLoadError}
        />
      ))}
    </div>
  );
}

function StoryboardOutlineGenHistoryTile({
  asset,
  indexFromNewest,
  onPreview,
  onImageLoadError,
}: {
  asset: StoryboardGeneratedAssetItem;
  indexFromNewest: number;
  onPreview?: (src: string, label: string) => void;
  onImageLoadError?: () => void;
}) {
  const sourceLabel = storyboardFrameVersionLabel(
    {
      id: asset.versionId || asset.id,
      createdAt: asset.createdAt,
      source: asset.source,
    },
    indexFromNewest
  );

  const handleDragStart = (event: React.DragEvent<HTMLImageElement>) => {
    event.stopPropagation();
    const payload: StoryboardFrameAssetDragPayload = {
      displaySrc: asset.displaySrc,
      rowId: asset.rowId,
      shotLabel: asset.shotLabel,
      createdAt: asset.createdAt,
    };
    writeStoryboardFrameAssetDragData(event.dataTransfer, payload);
  };

  return (
    <div className="group flex min-w-0 flex-col overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02]">
      <div className="relative aspect-[4/3] w-full bg-black/30">
        <img
          src={asset.displaySrc}
          alt=""
          draggable
          onPointerDownCapture={(event) => event.stopPropagation()}
          onDragStart={handleDragStart}
          onClick={() => onPreview?.(asset.displaySrc, asset.shotLabel)}
          onError={() => onImageLoadError?.()}
          className="h-full w-full cursor-grab object-cover active:cursor-grabbing"
        />
        {asset.isCurrent ? (
          <span className="absolute left-1 top-1 rounded bg-emerald-500/20 px-1 py-px text-[7px] font-semibold text-emerald-200/95 ring-1 ring-emerald-400/30">
            当前
          </span>
        ) : null}
      </div>
      <div className="px-1.5 py-1">
        <p className="truncate text-[9px] font-semibold text-gray-200">镜 {asset.shotLabel}</p>
        <p className="truncate text-[8px] text-gray-500">
          {sourceLabel}
          {formatAssetTime(asset.createdAt) ? ` · ${formatAssetTime(asset.createdAt)}` : ''}
        </p>
      </div>
    </div>
  );
}
