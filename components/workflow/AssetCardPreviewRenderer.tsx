import React from 'react';

import type { WorkflowAsset } from '../../types';
import { resolveWorkflowStepModelUrls } from '../../services/workflowStepModels';
import { resolveWorkflowAssetActiveVariant, resolveWorkflowAssetKind } from '../../services/workflowAssetVariants';
import { workflowAssetFormatBadgeLabel } from '../../services/workflowAssetFormatBadge';
import { captureWorkflowModelThumbnailDataUrl } from '../../services/workflowModelPreviewCapture';
import { previewSrcCacheFingerprint } from '../../services/workflowImageThumb';
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
  autoPlayVideo?: boolean;
  onIntrinsicSize?: (width: number, height: number) => void;
  onModelThumbnailCaptured?: (assetId: string, variantId: string, dataUrl: string) => void;
  companionBaseUrl?: string;
  companionProjectId?: string;
  compactBadges?: boolean;
};

const modelThumbnailCache = new Map<string, string | null>();
const modelThumbnailPending = new Map<string, Promise<string | null>>();
/** Serialize offscreen 3D thumb captures — parallel FBX/GLB decode black-screens GPUs. */
let modelThumbCaptureChain: Promise<unknown> = Promise.resolve();
function enqueueModelThumbCapture<T>(fn: () => Promise<T>): Promise<T> {
  const run = modelThumbCaptureChain.then(fn, fn);
  modelThumbCaptureChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/** @internal vitest only */
export function resetAssetCardModelThumbnailCachesForTests(): void {
  modelThumbnailCache.clear();
  modelThumbnailPending.clear();
}

/** 关闭 3D 预览强制写回缩略图后，同步网格缓存键前缀 `${assetId}:${variantId}:` */
export function rememberAssetCardModelThumbnail(
  assetId: string,
  variantId: string,
  dataUrl: string
): void {
  const id = String(assetId || '').trim();
  const vid = String(variantId || '').trim() || 'original';
  const thumb = String(dataUrl || '').trim();
  if (!id || !thumb) return;
  const prefix = `${id}:${vid}:`;
  for (const key of [...modelThumbnailCache.keys()]) {
    if (key.startsWith(prefix)) modelThumbnailCache.set(key, thumb);
  }
  modelThumbnailCache.set(`${prefix}lightbox`, thumb);
  modelThumbnailCache.set(`${prefix}model3d`, thumb);
}

function firstModelPreviewSrc(modelUrls?: string[], fallbackUrl?: string): string {
  return (modelUrls || []).find((value) => String(value || '').trim())?.trim() || String(fallbackUrl || '').trim();
}

/** Real poster/thumb already on the asset — never re-run offscreen 3D capture. */
function hasPersistedModelThumbnail(...candidates: Array<string | undefined>): boolean {
  for (const raw of candidates) {
    const s = String(raw || '').trim();
    if (!s) continue;
    if (/^data:image\/svg\+xml/i.test(s)) continue;
    // jpeg/png/webp data URLs, companion http(s), blob image posters, relative R2/API paths
    if (/^data:image\//i.test(s)) return true;
    if (/^(https?:|blob:|\/|\.\/)/i.test(s)) return true;
  }
  return false;
}

function modelFileNameHint(asset: WorkflowAsset, activeVariant: ReturnType<typeof resolveWorkflowAssetActiveVariant>, modelSrc: string): string {
  const sourceName = String(asset.modelSourceName || '').trim();
  if (sourceName) return sourceName;
  const key = String(activeVariant?.modelCompanionKeys?.[0] || '').trim();
  if (key) return key;
  const format = String(activeVariant?.modelFormats?.[0] || '').trim();
  if (format === 'glb' || format === 'gltf' || format === 'fbx' || format === 'obj') return `model.${format}`;
  return modelSrc;
}

function readableText(asset: WorkflowAsset, textDisplay?: string): { title: string; body: string } {
  const title = String(asset.textTitle || '').trim();
  const active = resolveWorkflowAssetActiveVariant(asset);
  const body =
    active?.id === 'original'
      ? String(textDisplay || asset.textBody || active?.text || '').trim()
      : String(active?.text || textDisplay || asset.textBody || '').trim();
  return { title, body };
}

function Badge({
  icon,
  label,
  compact = false,
}: {
  icon: 'video' | 'cube' | 'image' | 'package' | 'play' | 'chat';
  label: string;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div
        className="absolute left-0.5 top-0.5 z-[2] inline-flex h-3.5 w-3.5 items-center justify-center overflow-hidden rounded-[3px] border border-white/15 bg-black/50 text-white/80 shadow-sm backdrop-blur"
        title={label}
        aria-label={label}
      >
        <AppIcon name={icon} className="h-2 w-2 shrink-0" />
      </div>
    );
  }
  return (
    <div className="absolute left-2 top-2 z-[2] inline-flex max-w-[calc(100%-1rem)] items-center gap-1 rounded-md border border-white/12 bg-black/55 px-1.5 py-1 text-[9px] font-black uppercase leading-none text-white/85 shadow-sm backdrop-blur">
      <AppIcon name={icon} className="h-3 w-3 shrink-0" />
      {label ? <span className="truncate">{label}</span> : null}
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
  autoPlayVideo = false,
  onIntrinsicSize,
  onModelThumbnailCaptured,
  companionBaseUrl,
  companionProjectId,
  compactBadges = false,
}) => {
  const activeVariant = resolveWorkflowAssetActiveVariant(asset);
  const activeKind = activeVariant?.kind ?? resolveWorkflowAssetKind(asset);
  const activeKey = activeVariant?.id || asset.displayKey || 'original';
  const modelSrc =
    firstModelPreviewSrc(
      activeVariant?.modelUrls,
      activeVariant?.kind === 'model3d' ? activeVariant?.url : ''
    ) || firstModelPreviewSrc(resolveWorkflowStepModelUrls(asset, activeKey));
  const hasModelPreview = Boolean(activeKind === 'model3d' || modelSrc);
  // Stable key: do not include ephemeral blob: model URLs (they change every hydrate → false recapture).
  const modelThumbCacheKey =
    hasModelPreview
      ? `${asset.id}:${activeKey}:${String(asset.modelSourceName || activeVariant?.modelCompanionKeys?.[0] || activeVariant?.modelFormats?.[0] || 'model3d')}`
      : '';
  // previewSrc / posterUrl = image poster only; never treat model file URL (glb/fbx blob) as a thumb.
  const persistedPreview =
    hasModelPreview && hasPersistedModelThumbnail(previewSrc, activeVariant?.posterUrl);
  const [capturedModelThumb, setCapturedModelThumb] = React.useState<string>(() => {
    if (!modelThumbCacheKey) return '';
    const cached = modelThumbnailCache.get(modelThumbCacheKey);
    if (cached) return cached;
    return '';
  });

  React.useEffect(() => {
    if (!hasModelPreview || !modelSrc || !modelThumbCacheKey) {
      setCapturedModelThumb('');
      return;
    }
    // Already have a real poster/thumb on the asset — show image only, do not load 3D.
    if (persistedPreview) {
      const fromPoster = hasPersistedModelThumbnail(activeVariant?.posterUrl)
        ? String(activeVariant?.posterUrl || '').trim()
        : '';
      const fromPreview = hasPersistedModelThumbnail(previewSrc) ? String(previewSrc || '').trim() : '';
      // Prefer viewport/close poster over stale original / image-full card face.
      const seed = fromPoster || fromPreview;
      if (seed) {
        modelThumbnailCache.set(modelThumbCacheKey, seed);
        setCapturedModelThumb(seed);
        return;
      }
      setCapturedModelThumb('');
      return;
    }
    const cached = modelThumbnailCache.get(modelThumbCacheKey);
    if (cached !== undefined) {
      setCapturedModelThumb(cached || '');
      return;
    }
    let cancelled = false;
    const pending =
      modelThumbnailPending.get(modelThumbCacheKey) ||
      captureWorkflowModelThumbnailDataUrl({
        modelSrc,
        modelFileName: modelFileNameHint(asset, activeVariant, modelSrc),
        width: 896,
        height: 560,
        timeoutMs: 55_000,
      })
        .catch(() => null)
        .finally(() => {
          modelThumbnailPending.delete(modelThumbCacheKey);
        });
    if (!modelThumbnailPending.has(modelThumbCacheKey)) {
      modelThumbnailPending.set(modelThumbCacheKey, pending);
    }
    pending.then((thumb) => {
      modelThumbnailCache.set(modelThumbCacheKey, thumb || null);
      if (cancelled) return;
      setCapturedModelThumb(thumb || '');
      if (thumb) onModelThumbnailCaptured?.(asset.id, activeKey, thumb);
    });
    return () => {
      cancelled = true;
    };
  }, [
    hasModelPreview,
    persistedPreview,
    previewSrc,
    activeKey,
    activeVariant?.id,
    activeVariant?.modelCompanionKeys,
    activeVariant?.modelFormats,
    activeVariant?.posterUrl,
    asset.id,
    asset.modelSourceName,
    modelSrc,
    modelThumbCacheKey,
    onModelThumbnailCaptured,
  ]);

  // Never show the SVG "本地预览" placeholder as if it were a captured model thumb.
  const rasterPreview =
    String(capturedModelThumb || '').trim() ||
    (hasPersistedModelThumbnail(previewSrc) ? String(previewSrc || '').trim() : '') ||
    (hasPersistedModelThumbnail(activeVariant?.posterUrl)
      ? String(activeVariant?.posterUrl || '').trim()
      : '');
  const displaySrc = hasModelPreview
    ? rasterPreview
    : previewSrc || activeVariant?.posterUrl || activeVariant?.url || '';
  const formatBadge = workflowAssetFormatBadgeLabel(asset, activeVariant);

  if (activeKind === 'text' && !displaySrc.trim()) {
    const { title, body } = readableText(asset, textDisplay);
    return (
      <div className="relative flex h-full w-full flex-col justify-start bg-[#141416] p-3 text-left">
        <Badge icon="chat" label={formatBadge} />
        <div className="h-5 shrink-0" aria-hidden />
        {title ? (
          <p className="mb-1.5 line-clamp-2 text-[11px] font-bold leading-snug text-gray-100">{title}</p>
        ) : null}
        <p
          className={`min-h-0 flex-1 overflow-hidden whitespace-pre-wrap text-[10px] leading-snug text-gray-400 ${
            title ? 'line-clamp-6' : 'line-clamp-8'
          }`}
        >
          {body || '空白文本资产'}
        </p>
      </div>
    );
  }

  if (activeKind === 'audio') {
    return <AudioWavePlaceholder label={formatBadge} />;
  }

  if (activeKind === 'file') {
    return <FilePlaceholder label={formatBadge || '无预览'} />;
  }

  // Bust ProgressivePreview LRU when viewport poster bytes change but parent cacheKey is stable.
  const gridCacheKey = `${cacheKey}:fp${previewSrcCacheFingerprint(displaySrc || previewSrc)}`;

  return (
    <div className="relative flex h-full w-full justify-center bg-[#141416]">
      {displaySrc.trim() ? (
        <WorkflowGridImage
          fullSrc={displaySrc}
          cacheKey={gridCacheKey}
          mediaVariant={activeKind === 'video' ? 'video' : 'image'}
          autoPlayVideo={activeKind === 'video' && autoPlayVideo}
          videoPosterSrc={activeKind === 'video' ? activeVariant?.posterUrl : undefined}
          thumbMaxEdge={thumbMaxEdge}
          deferThumbnail={deferThumbnail}
          thumbDecodePriority={thumbDecodePriority}
          imageFetchPriority={imageFetchPriority}
          companionBaseUrl={companionBaseUrl}
          companionProjectId={companionProjectId}
          className="relative z-0 block h-full w-full"
          imgClassName="relative z-0 block h-full w-full object-cover"
          draggable={false}
          onDragStart={(e) => e.preventDefault()}
          onIntrinsicSize={onIntrinsicSize}
        />
      ) : hasModelPreview ? (
        <FilePlaceholder label={formatBadge || '无预览'} />
      ) : (
        <FilePlaceholder label="无预览" />
      )}
      {activeKind === 'video' ? <Badge icon="video" label={formatBadge} compact={compactBadges} /> : null}
      {hasModelPreview ? <Badge icon="cube" label={formatBadge} compact={compactBadges} /> : null}
      <div
        aria-hidden
        className="absolute inset-0 z-[1]"
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
      />
    </div>
  );
};
