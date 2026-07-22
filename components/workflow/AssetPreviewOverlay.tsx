import React from 'react';

import { ImagePreviewOverlay, type ImagePreviewOverlayProps } from '../ImagePreviewOverlay';
import type {
  AssetPreviewAction,
  AssetCapabilityOutputAsset,
  ImagePreviewLayoutMode,
  Model3DDisplayMode,
} from '../preview';
import { AssetPreviewShell } from '../preview';
import type { WorkflowAsset, WorkflowAssetVariant } from '../../types';

export type AssetPreviewOverlayProps = ImagePreviewOverlayProps & {
  /**
   * Productized asset preview bridge.
   *
   * Image assets still use the mature image preview engine. Non-image assets
   * enter this canvas slot so their viewers no longer need to impersonate an
   * image lightbox or draw a second modal shell.
   */
  assetCanvasClassName?: string;
  /** 当前预览资产：提供后启用资产级预览壳、adapter 和能力面板。 */
  asset?: WorkflowAsset;
  /** 当前预览版本：由工作流资产 resolver 提供。 */
  variant?: WorkflowAssetVariant | null;
  /** 当前预览 layout：用于 adapter 判断图片/3D 当前状态。 */
  previewLayout?: ImagePreviewLayoutMode;
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
  onUseCapabilityOutputAsInput?: (output: AssetCapabilityOutputAsset) => void;
  onSaveCapabilityOutput?: (output: AssetCapabilityOutputAsset) => void;
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
  previewLayout,
  model3dDisplayMode,
  onModel3dDisplayModeChange,
  onDownloadCurrent,
  onCopyCurrent,
  onStartCrop,
  onRunRembg,
  onCapturePreview,
  onAddCurrentToInput,
  onModel3dResetView,
  onModel3dToggleGrid,
  onModel3dToggleBackfaceCulling,
  onUseCapabilityOutputAsInput,
  onSaveCapabilityOutput,
  ...props
}) => {
  const assetCenterSlot = centerSlot ? (
    <AssetPreviewCanvas className={assetCanvasClassName}>{centerSlot}</AssetPreviewCanvas>
  ) : undefined;

  const handleShellAction = React.useCallback(
    async (action: AssetPreviewAction) => {
      if (action.id === 'download') return onDownloadCurrent?.();
      if (action.id === 'copy') return onCopyCurrent?.();
      if (action.id === 'start-crop') return onStartCrop?.();
      if (action.id === 'run-rembg') return onRunRembg?.();
      if (action.id === 'capture-preview') return onCapturePreview?.();
      if (action.id === 'add-to-input') return onAddCurrentToInput?.();
      if (action.id === 'reset-camera') return onModel3dResetView?.();
      if (action.id === 'toggle-grid') return onModel3dToggleGrid?.();
      if (action.id === 'toggle-backface-culling') return onModel3dToggleBackfaceCulling?.();
      if (String(action.id).startsWith('display-mode:')) {
        const mode = String(action.id).slice('display-mode:'.length) as Model3DDisplayMode;
        return onModel3dDisplayModeChange?.(mode);
      }
      return undefined;
    },
    [
      onAddCurrentToInput,
      onCapturePreview,
      onCopyCurrent,
      onDownloadCurrent,
      onModel3dDisplayModeChange,
      onModel3dResetView,
      onModel3dToggleBackfaceCulling,
      onModel3dToggleGrid,
      onRunRembg,
      onStartCrop,
    ]
  );

  const imagePreviewProps: ImagePreviewOverlayProps = {
    ...(props as ImagePreviewOverlayProps),
    centerSlot: assetCenterSlot,
    model3dDisplayMode,
  };

  return (
    <ImagePreviewOverlay {...imagePreviewProps}>
      {asset ? (
        <AssetPreviewShell
          asset={asset}
          variant={variant ?? null}
          previewLayout={previewLayout}
          model3dDisplayMode={model3dDisplayMode}
          model3dGridVisible={props.model3dShowGrid}
          model3dBackfaceCulling={props.model3dBackfaceCulling}
          onAction={handleShellAction}
          onUseOutputAsInput={onUseCapabilityOutputAsInput}
          onSaveOutput={onSaveCapabilityOutput}
        />
      ) : null}
      {props.children}
    </ImagePreviewOverlay>
  );
};
