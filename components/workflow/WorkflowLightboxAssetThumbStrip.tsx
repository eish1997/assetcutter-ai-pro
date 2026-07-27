import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkflowAsset } from '../../types';
import { resolveWorkflowStepModelUrls } from '../../services/workflowStepModels';
import { resolveWorkflowAssetActiveVariant, resolveWorkflowAssetKind } from '../../services/workflowAssetVariants';
import { workflowVersionTextThumbLines } from '../../services/workflowTextAsset';
import { WorkflowGridImage } from '../ProgressivePreviewImage';
import { AssetCardPreviewRenderer } from './AssetCardPreviewRenderer';
import WorkflowVersionTextThumbCell from './WorkflowVersionTextThumbCell';
import { WORKFLOW_LIGHTBOX_ASSET_THUMB_STRIP_WIDTH_CLASS } from './workflowSectionUiConstants';
import WorkflowAssetContextMenu from './WorkflowAssetContextMenu';

export type WorkflowLightboxAssetThumbStripProps = {
  assets: WorkflowAsset[];
  activeAssetId: string;
  onSelectAsset: (assetId: string) => void;
  getPreviewSrc: (asset: WorkflowAsset) => string;
  canCopyImage?: (asset: WorkflowAsset) => boolean;
  onCopyImage?: (asset: WorkflowAsset) => void | Promise<void>;
  onCopyId?: (asset: WorkflowAsset) => void | Promise<void>;
  canOpenFolder?: (asset: WorkflowAsset) => boolean;
  openFolderDisabledReason?: (asset: WorkflowAsset) => string;
  onOpenFolder?: (asset: WorkflowAsset) => void | Promise<void>;
  onAddToComposeInput?: (asset: WorkflowAsset) => void | Promise<void>;
  canAddToComposeInput?: (asset: WorkflowAsset) => boolean;
  getMediaVariant?: (asset: WorkflowAsset) => 'image' | 'video';
  onModelThumbnailCaptured?: (assetId: string, variantId: string, dataUrl: string) => void;
  companionBaseUrl?: string;
  companionProjectId?: string;
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
  canOpenFolder,
  openFolderDisabledReason,
  onOpenFolder,
  onAddToComposeInput,
  canAddToComposeInput,
  getMediaVariant,
  onModelThumbnailCaptured,
  companionBaseUrl,
  companionProjectId,
}: WorkflowLightboxAssetThumbStripProps) {
  const activeBtnRef = useRef<HTMLButtonElement>(null);
  const [contextMenu, setContextMenu] = useState<{
    asset: WorkflowAsset;
    x: number;
    y: number;
  } | null>(null);

  const handleThumbContextMenu = useCallback(
    (asset: WorkflowAsset, e: React.MouseEvent) => {
      if (!onCopyImage && !onCopyId && !onOpenFolder && !onAddToComposeInput) return;
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ asset, x: e.clientX, y: e.clientY });
    },
    [onAddToComposeInput, onCopyId, onCopyImage, onOpenFolder]
  );

  useEffect(() => {
    const el = activeBtnRef.current;
    if (!el) return;
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeAssetId, assets.length]);

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
        <div className="relative min-h-0 flex-1">
          <div
            className={[
              'min-h-0 flex h-full flex-col gap-1 overflow-y-auto overscroll-y-contain px-1 py-2',
              'no-scrollbar [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden',
            ].join(' ')}
            data-lightbox-asset-thumb-strip-scroll
          >
            {assets.map((asset) => {
              const active = asset.id === activeAssetId;
              const previewSrc = getPreviewSrc(asset);
              const activeVariant = resolveWorkflowAssetActiveVariant(asset);
              const activeKind = activeVariant?.kind ?? resolveWorkflowAssetKind(asset);
              const hasModelPreview =
                activeKind === 'model3d' ||
                Boolean(activeVariant?.modelUrls?.some((url) => String(url || '').trim())) ||
                resolveWorkflowStepModelUrls(asset, asset.displayKey || 'original').some((url) =>
                  String(url || '').trim()
                );
              const title = String((asset as { label?: unknown }).label || '').trim() || asset.id.slice(0, 8);
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
                      ? `${title} · 右键复制 / 复制 ID / 添加到输入框`
                      : title
                  }
                  aria-label={title || `资产 ${asset.id.slice(0, 8)}`}
                  aria-current={active ? 'true' : undefined}
                >
                  {textThumb ? (
                    <WorkflowVersionTextThumbCell
                      lines={textThumb}
                      textClassName="text-[7px] leading-[1.1] text-gray-300"
                    />
                  ) : hasModelPreview ? (
                    <AssetCardPreviewRenderer
                      asset={asset}
                      previewSrc={previewSrc}
                      cacheKey={`lightbox-strip:${asset.id}:${asset.displayKey}`}
                      thumbMaxEdge={128}
                      deferThumbnail={false}
                      autoPlayVideo={active}
                      onModelThumbnailCaptured={onModelThumbnailCaptured}
                      companionBaseUrl={companionBaseUrl}
                      companionProjectId={companionProjectId}
                      compactBadges
                    />
                  ) : (
                    <WorkflowGridImage
                      fullSrc={previewSrc}
                      cacheKey={`lightbox-strip:${asset.id}:${asset.displayKey}`}
                      thumbMaxEdge={128}
                      mediaVariant={getMediaVariant?.(asset) ?? 'image'}
                      autoPlayVideo={active}
                      companionBaseUrl={companionBaseUrl}
                      companionProjectId={companionProjectId}
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
            })}
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
          canOpenFolder={canOpenFolder?.(contextMenu.asset) ?? Boolean(onOpenFolder)}
          openFolderDisabledReason={openFolderDisabledReason?.(contextMenu.asset) || ''}
          onOpenFolder={
            onOpenFolder
              ? () => {
                  void onOpenFolder(contextMenu.asset);
                }
              : undefined
          }
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
