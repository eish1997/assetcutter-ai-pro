import React from 'react';

import type { WorkflowAsset } from '../../types';
import { resolveWorkflowAssetActiveVariant, resolveWorkflowAssetKind } from '../../services/workflowAssetVariants';
import { WorkflowGridImage } from '../ProgressivePreviewImage';
import AppIcon from '../ui/AppIcon';

type AssetCardPreviewRendererProps = {
  asset: WorkflowAsset;
  previewSrc: string;
  cacheKey: string;
  textDisplay?: string;
  deferThumbnail?: boolean;
  thumbDecodePriority?: 'high' | 'low';
  imageFetchPriority?: 'high' | 'low' | 'auto';
  thumbMaxEdge?: number;
  onIntrinsicSize?: (width: number, height: number) => void;
};

function readableText(asset: WorkflowAsset, textDisplay?: string): { title: string; body: string } {
  const title = String(asset.textTitle || '').trim();
  const active = resolveWorkflowAssetActiveVariant(asset);
  const body =
    active?.id === 'original'
      ? String(textDisplay || asset.textBody || active?.text || '').trim()
      : String(active?.text || textDisplay || asset.textBody || '').trim();
  return { title, body };
}

function Badge({ icon, label }: { icon: 'video' | 'cube' | 'image' | 'package' | 'play'; label: string }) {
  return (
    <div className="absolute left-2 top-2 z-[2] inline-flex max-w-[calc(100%-1rem)] items-center gap-1 rounded-md border border-white/12 bg-black/55 px-1.5 py-1 text-[9px] font-black uppercase leading-none text-white/85 shadow-sm backdrop-blur">
      <AppIcon name={icon} className="h-3 w-3 shrink-0" />
      <span className="truncate">{label}</span>
    </div>
  );
}

function AudioWavePlaceholder({ label }: { label: string }) {
  const bars = [28, 54, 38, 72, 45, 64, 34, 58, 42, 76, 36, 52, 30, 60];
  return (
    <div className="relative flex h-full w-full flex-col justify-between bg-[#141416] p-3">
      <Badge icon="play" label={label} />
      <div className="flex flex-1 items-center justify-center gap-1.5 pt-6">
        {bars.map((height, index) => (
          <span
            key={index}
            className="w-1 rounded-full bg-emerald-300/70"
            style={{ height: `${height}%`, maxHeight: '4.5rem' }}
          />
        ))}
      </div>
      <div className="h-1 rounded-full bg-white/10">
        <div className="h-full w-1/3 rounded-full bg-emerald-300/70" />
      </div>
    </div>
  );
}

function FilePlaceholder({ label }: { label: string }) {
  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center bg-[#141416] p-3 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-gray-300">
        <AppIcon name="package" className="h-6 w-6" />
      </div>
      <p className="mt-2 max-w-full truncate text-[10px] font-bold text-gray-300">{label}</p>
    </div>
  );
}

export const AssetCardPreviewRenderer: React.FC<AssetCardPreviewRendererProps> = ({
  asset,
  previewSrc,
  cacheKey,
  textDisplay,
  deferThumbnail,
  thumbDecodePriority,
  imageFetchPriority,
  thumbMaxEdge,
  onIntrinsicSize,
}) => {
  const activeVariant = resolveWorkflowAssetActiveVariant(asset);
  const activeKind = activeVariant?.kind ?? resolveWorkflowAssetKind(asset);
  const displaySrc =
    activeKind === 'model3d'
      ? previewSrc || activeVariant?.posterUrl || ''
      : previewSrc || activeVariant?.posterUrl || activeVariant?.url || '';

  if (activeKind === 'text' && !displaySrc.trim()) {
    const { title, body } = readableText(asset, textDisplay);
    return (
      <div className="relative flex h-full w-full flex-col justify-start bg-[#141416] p-3 text-left">
        {title ? (
          <p className="mb-1.5 line-clamp-2 text-[11px] font-bold leading-snug text-gray-100">{title}</p>
        ) : null}
        <p
          className={`min-h-0 flex-1 overflow-hidden whitespace-pre-wrap text-[10px] leading-snug text-gray-400 ${
            title ? 'line-clamp-6' : 'line-clamp-8'
          }`}
        >
          {body || '(Empty text asset)'}
        </p>
      </div>
    );
  }

  if (activeKind === 'audio') {
    return <AudioWavePlaceholder label={activeVariant?.label || 'Audio'} />;
  }

  if (activeKind === 'file') {
    return <FilePlaceholder label={activeVariant?.label || 'File'} />;
  }

  return (
    <div className="relative flex h-full w-full justify-center bg-[#141416]">
      <WorkflowGridImage
        fullSrc={displaySrc}
        cacheKey={cacheKey}
        mediaVariant={activeKind === 'video' ? 'video' : 'image'}
        thumbMaxEdge={thumbMaxEdge}
        deferThumbnail={deferThumbnail}
        thumbDecodePriority={thumbDecodePriority}
        imageFetchPriority={imageFetchPriority}
        className="relative z-0 block h-full min-h-[5rem] w-full"
        imgClassName="relative z-0 block h-full w-full object-cover"
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
        onIntrinsicSize={onIntrinsicSize}
      />
      {activeKind === 'video' ? <Badge icon="video" label="Video" /> : null}
      {activeKind === 'model3d' ? (
        <Badge icon="cube" label={activeVariant?.modelFormats?.filter(Boolean).join(' + ') || '3D'} />
      ) : null}
      {!displaySrc.trim() && activeKind !== 'image' ? <FilePlaceholder label={activeVariant?.label || activeKind} /> : null}
      <div
        aria-hidden
        className="absolute inset-0 z-[1]"
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
      />
    </div>
  );
};
