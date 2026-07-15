import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkflowAsset } from '../../types';
import { resolveWorkflowAssetVariants } from '../../services/workflowAssetVariants';
import { workflowVersionTextThumbLines } from '../../services/workflowTextAsset';
import { WorkflowGridImage } from '../ProgressivePreviewImage';
import WorkflowVersionTextThumbCell from './WorkflowVersionTextThumbCell';
import { WORKFLOW_LIGHTBOX_ASSET_THUMB_STRIP_WIDTH_CLASS } from './workflowSectionUiConstants';
import WorkflowAssetContextMenu from './WorkflowAssetContextMenu';
import AppIcon from '../ui/AppIcon';

export type WorkflowLightboxAssetThumbStripProps = {
  assets: WorkflowAsset[];
  activeAssetId: string;
  onSelectAsset: (assetId: string) => void;
  getPreviewSrc: (asset: WorkflowAsset) => string;
  canCopyImage?: (asset: WorkflowAsset) => boolean;
  onCopyImage?: (asset: WorkflowAsset) => void | Promise<void>;
  onCopyId?: (asset: WorkflowAsset) => void | Promise<void>;
  onAddToComposeInput?: (asset: WorkflowAsset) => void | Promise<void>;
  canAddToComposeInput?: (asset: WorkflowAsset) => boolean;
  getMediaVariant?: (asset: WorkflowAsset) => 'image' | 'video';
  onSelectVersion?: (assetId: string, versionId: string) => void;
};

/**
 * 大图预览右侧窄条：纵向展示资产列表缩略图（最新在上），突出当前项。
 */
export default function WorkflowLightboxAssetThumbStrip({
  assets,
  activeAssetId,
  onSelectAsset,
  getPreviewSrc,
  canCopyImage,
  onCopyImage,
  onCopyId,
  onAddToComposeInput,
  canAddToComposeInput,
  getMediaVariant,
  onSelectVersion,
}: WorkflowLightboxAssetThumbStripProps) {
  const activeBtnRef = useRef<HTMLButtonElement>(null);
  const activeVersionBtnRef = useRef<HTMLButtonElement>(null);
  const [tab, setTab] = useState<'assets' | 'versions'>('assets');
  const [contextMenu, setContextMenu] = useState<{
    asset: WorkflowAsset;
    x: number;
    y: number;
  } | null>(null);
  const activeAsset = assets.find((asset) => asset.id === activeAssetId) ?? null;
  const activeVariants = activeAsset ? resolveWorkflowAssetVariants(activeAsset) : [];
  const canShowVersions = Boolean(activeAsset && activeVariants.length > 0 && onSelectVersion);

  const handleThumbContextMenu = useCallback(
    (asset: WorkflowAsset, e: React.MouseEvent) => {
      if (!onCopyImage && !onCopyId && !onAddToComposeInput) return;
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ asset, x: e.clientX, y: e.clientY });
    },
    [onAddToComposeInput, onCopyId, onCopyImage]
  );

  useEffect(() => {
    const el = activeBtnRef.current;
    if (!el) return;
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeAssetId, assets.length]);

  useEffect(() => {
    if (tab !== 'versions') return;
    const el = activeVersionBtnRef.current;
    if (!el) return;
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeAsset?.displayKey, activeVariants.length, tab]);

  useEffect(() => {
    if (!canShowVersions && tab === 'versions') setTab('assets');
  }, [canShowVersions, tab]);

  return (
    <>
      <div
        className={[
          'pointer-events-auto relative flex h-full w-full shrink-0 flex-col',
          WORKFLOW_LIGHTBOX_ASSET_THUMB_STRIP_WIDTH_CLASS,
          'min-w-[3.5rem] max-w-[3.5rem] w-[3.5rem]',
          'border-l border-white/10 bg-[#0a0a0c]/88 shadow-[-4px_0_24px_rgba(0,0,0,0.38)] backdrop-blur-[2px]',
        ].join(' ')}
        role="navigation"
        aria-label="资产列表缩略图"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 gap-1 border-b border-white/10 p-1">
          <button
            type="button"
            onClick={() => setTab('assets')}
            className={[
              'h-7 flex-1 rounded-md text-[9px] font-black transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60',
              tab === 'assets'
                ? 'bg-blue-600 text-white'
                : 'bg-white/[0.04] text-gray-400 hover:bg-white/[0.08] hover:text-gray-200',
            ].join(' ')}
            title="资产"
          >
            资产
          </button>
          <button
            type="button"
            disabled={!canShowVersions}
            onClick={() => {
              if (canShowVersions) setTab('versions');
            }}
            className={[
              'h-7 flex-1 rounded-md text-[9px] font-black transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60',
              tab === 'versions'
                ? 'bg-blue-600 text-white'
                : 'bg-white/[0.04] text-gray-400 hover:bg-white/[0.08] hover:text-gray-200',
              !canShowVersions ? 'cursor-not-allowed opacity-35 hover:bg-white/[0.04] hover:text-gray-400' : '',
            ].join(' ')}
            title="版本"
          >
            版本
          </button>
        </div>
        <div className="relative min-h-0 flex-1">
          <div
            className={[
              'min-h-0 flex h-full flex-col gap-1 overflow-y-auto overscroll-y-contain px-1 py-2',
              'no-scrollbar [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden',
            ].join(' ')}
            data-lightbox-asset-thumb-strip-scroll
          >
            {tab === 'assets' ? assets.map((asset) => {
              const active = asset.id === activeAssetId;
              const previewSrc = getPreviewSrc(asset);
              const textThumb =
                !String(previewSrc || '').trim()
                  ? workflowVersionTextThumbLines(asset, asset.displayKey || 'original')
                  : null;
              return (
                <button
                  key={asset.id}
                  ref={active ? activeBtnRef : undefined}
                  type="button"
                  data-ac-allow-context-menu
                  onContextMenu={(e) => handleThumbContextMenu(asset, e)}
                  onClick={() => {
                    if (asset.id === activeAssetId) return;
                    onSelectAsset(asset.id);
                  }}
                  className={[
                    'relative aspect-square w-full shrink-0 overflow-hidden rounded-md transition-opacity duration-150 outline-none',
                    'focus-visible:ring-2 focus-visible:ring-blue-500/70 focus-visible:ring-offset-1 focus-visible:ring-offset-[#0a0a0c]',
                    active
                      ? 'z-[1] opacity-100 ring-2 ring-blue-500/95 shadow-[0_0_10px_rgba(59,130,246,0.35)]'
                      : 'opacity-55 ring-1 ring-white/10 hover:opacity-90 hover:ring-white/25',
                  ].join(' ')}
                  title={
                    onCopyImage || onCopyId || onAddToComposeInput
                      ? `${asset.label?.trim() || asset.id.slice(0, 8)} · 右键复制 / 复制 ID / 添加到输入框`
                      : asset.label?.trim() || asset.id.slice(0, 8)
                  }
                  aria-label={asset.label?.trim() || `资产 ${asset.id.slice(0, 8)}`}
                  aria-current={active ? 'true' : undefined}
                >
                  {textThumb ? (
                    <WorkflowVersionTextThumbCell
                      lines={textThumb}
                      textClassName="text-[7px] leading-[1.1] text-gray-300"
                    />
                  ) : (
                    <WorkflowGridImage
                      fullSrc={previewSrc}
                      cacheKey={`lightbox-strip:${asset.id}:${asset.displayKey}`}
                      thumbMaxEdge={128}
                      mediaVariant={getMediaVariant?.(asset) ?? 'image'}
                      className="h-full w-full"
                      imgClassName="block h-full w-full object-cover"
                      alt=""
                    />
                  )}
                  {active ? (
                    <span
                      className="pointer-events-none absolute inset-y-1 left-0 w-0.5 rounded-full bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.85)]"
                      aria-hidden
                    />
                  ) : null}
                </button>
              );
            }) : activeAsset ? activeVariants.map((variant) => {
              const active = variant.id === (activeAsset.displayKey || 'original');
              const versionAsset = { ...activeAsset, displayKey: variant.id };
              const previewSrc = variant.kind === 'model3d'
                ? variant.posterUrl || getPreviewSrc(versionAsset)
                : getPreviewSrc(versionAsset) || variant.posterUrl || variant.url || '';
              const textThumb =
                variant.kind === 'text'
                  ? workflowVersionTextThumbLines(activeAsset, variant.id)
                  : null;
              const mediaVariant = variant.kind === 'video' ? 'video' : 'image';
              const iconName = variant.kind === 'model3d'
                ? 'cube'
                : variant.kind === 'video'
                  ? 'video'
                  : variant.kind === 'text'
                    ? 'chat'
                    : variant.kind === 'audio'
                      ? 'play'
                      : 'image';
              return (
                <button
                  key={variant.id}
                  ref={active ? activeVersionBtnRef : undefined}
                  type="button"
                  onClick={() => {
                    if (active) return;
                    onSelectVersion?.(activeAsset.id, variant.id);
                  }}
                  className={[
                    'relative aspect-square w-full shrink-0 overflow-hidden rounded-md transition-opacity duration-150 outline-none',
                    'focus-visible:ring-2 focus-visible:ring-blue-500/70 focus-visible:ring-offset-1 focus-visible:ring-offset-[#0a0a0c]',
                    active
                      ? 'z-[1] opacity-100 ring-2 ring-blue-500/95 shadow-[0_0_10px_rgba(59,130,246,0.35)]'
                      : 'opacity-55 ring-1 ring-white/10 hover:opacity-90 hover:ring-white/25',
                  ].join(' ')}
                  title={variant.label || variant.id}
                  aria-label={variant.label || variant.id}
                  aria-current={active ? 'true' : undefined}
                >
                  {textThumb ? (
                    <WorkflowVersionTextThumbCell
                      lines={textThumb}
                      textClassName="text-[7px] leading-[1.1] text-gray-300"
                    />
                  ) : previewSrc.trim() ? (
                    <WorkflowGridImage
                      fullSrc={previewSrc}
                      cacheKey={`lightbox-version:${activeAsset.id}:${variant.id}`}
                      thumbMaxEdge={128}
                      mediaVariant={mediaVariant}
                      className="h-full w-full"
                      imgClassName="block h-full w-full object-cover"
                      alt=""
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-[#141416] text-gray-400">
                      <AppIcon name={iconName} className="h-5 w-5" />
                    </div>
                  )}
                  <span className="pointer-events-none absolute bottom-1 left-1 right-1 flex items-center gap-1 rounded bg-black/55 px-1 py-0.5 text-[7px] font-bold leading-none text-white/80 backdrop-blur">
                    <AppIcon name={iconName} className="h-2.5 w-2.5 shrink-0" />
                    <span className="truncate">{variant.label || variant.id}</span>
                  </span>
                  {active ? (
                    <span
                      className="pointer-events-none absolute inset-y-1 left-0 w-0.5 rounded-full bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.85)]"
                      aria-hidden
                    />
                  ) : null}
                </button>
              );
            }) : null}
          </div>
          <div
            className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-5 bg-gradient-to-b from-[#0a0a0c] via-[#0a0a0c]/70 to-transparent"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-5 bg-gradient-to-t from-[#0a0a0c] via-[#0a0a0c]/70 to-transparent"
            aria-hidden
          />
        </div>
      </div>

      {contextMenu ? (
        <WorkflowAssetContextMenu
          open
          x={contextMenu.x}
          y={contextMenu.y}
          canCopyImage={canCopyImage?.(contextMenu.asset) ?? Boolean(onCopyImage)}
          onCopyImage={() => {
            if (onCopyImage) void onCopyImage(contextMenu.asset);
          }}
          onCopyId={() => {
            if (onCopyId) void onCopyId(contextMenu.asset);
          }}
          canAddToComposeInput={
            (canAddToComposeInput?.(contextMenu.asset) ??
              (canCopyImage?.(contextMenu.asset) ?? Boolean(onCopyImage))) &&
            Boolean(onAddToComposeInput)
          }
          onAddToComposeInput={
            onAddToComposeInput
              ? () => {
                  void onAddToComposeInput(contextMenu.asset);
                }
              : undefined
          }
          onClose={() => setContextMenu(null)}
        />
      ) : null}
    </>
  );
}
