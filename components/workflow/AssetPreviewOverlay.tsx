import React from 'react';

import { ImagePreviewOverlay, type ImagePreviewOverlayProps } from '../ImagePreviewOverlay';
import type { ImagePreviewLayoutMode, Model3DDisplayMode } from '../preview';
import type { WorkflowAsset, WorkflowAssetKind, WorkflowAssetVariant } from '../../types';
import { resolveWorkflowAssetPbrEditDoc } from '../../services/workflowModelPbrEdits';

export type AssetPreviewOverlayProps = ImagePreviewOverlayProps & {
  /**
   * Productized asset preview bridge.
   *
   * Image assets still use the mature image preview engine. Non-image assets
   * enter this canvas slot so their viewers no longer need to impersonate an
   * image lightbox or draw a second modal shell.
   */
  assetCanvasClassName?: string;
  asset?: WorkflowAsset;
  variant?: WorkflowAssetVariant | null;
  previewLayout?: ImagePreviewLayoutMode;
  previewKindOverride?: WorkflowAssetKind;
  onModel3dDisplayModeChange?: (mode: Model3DDisplayMode) => void;
  onDownloadCurrent?: () => void | Promise<void>;
  onCopyCurrent?: () => void | Promise<void>;
  onStartCrop?: () => void | Promise<void>;
  onRunRembg?: () => void | Promise<void>;
  onCapturePreview?: () => void | Promise<void>;
  onAddCurrentToInput?: () => void | Promise<void>;
  onModel3dResetView?: () => void | Promise<void>;
  onModel3dToggleGrid?: () => void | Promise<void>;
  onModel3dToggleBackfaceCulling?: () => void | Promise<void>;
  onUseCapabilityOutputAsInput?: (output: unknown) => void;
  onSaveCapabilityOutput?: (output: unknown) => void;
};

const DEFAULT_ASSET_CANVAS_CLASS =
  'flex h-full w-full min-h-0 min-w-0 items-stretch justify-center overflow-hidden';

function AssetPreviewCanvas({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={[DEFAULT_ASSET_CANVAS_CLASS, className || ''].filter(Boolean).join(' ')}
      data-asset-preview-canvas
      data-image-preview-no-wheel
    >
      {children}
    </div>
  );
}

export const AssetPreviewOverlay: React.FC<AssetPreviewOverlayProps> = ({
  centerSlot,
  assetCanvasClassName,
  asset,
  variant,
  previewLayout: _previewLayout,
  previewKindOverride: _previewKindOverride,
  onModel3dDisplayModeChange: _onModel3dDisplayModeChange,
  onDownloadCurrent: _onDownloadCurrent,
  onCopyCurrent: _onCopyCurrent,
  onStartCrop: _onStartCrop,
  onRunRembg: _onRunRembg,
  onCapturePreview: _onCapturePreview,
  onAddCurrentToInput: _onAddCurrentToInput,
  onModel3dResetView: _onModel3dResetView,
  onModel3dToggleGrid: _onModel3dToggleGrid,
  onModel3dToggleBackfaceCulling: _onModel3dToggleBackfaceCulling,
  onUseCapabilityOutputAsInput: _onUseCapabilityOutputAsInput,
  onSaveCapabilityOutput: _onSaveCapabilityOutput,
  model3dDisplayMode,
  children,
  ...props
}) => {
  const assetCenterSlot = centerSlot ? (
    <AssetPreviewCanvas className={assetCanvasClassName}>{centerSlot}</AssetPreviewCanvas>
  ) : undefined;

  const imagePreviewProps: ImagePreviewOverlayProps = {
    ...(props as ImagePreviewOverlayProps),
    centerSlot: assetCenterSlot,
    model3dDisplayMode,
    model3dAssetId: asset?.id,
    model3dVariantId: variant?.id,
    model3dModelKey: variant?.modelUrls?.[0] || variant?.url || props.modelUrls?.[0],
    model3dPbrEditDoc: resolveWorkflowAssetPbrEditDoc(asset, {
      stepKey: asset?.displayKey,
      variantId: variant?.id,
      modelKey: variant?.modelCompanionKeys?.[0] || variant?.modelUrls?.[0] || variant?.url || props.modelUrls?.[0],
    }),
  };

  return <ImagePreviewOverlay {...imagePreviewProps}>{children}</ImagePreviewOverlay>;
};
