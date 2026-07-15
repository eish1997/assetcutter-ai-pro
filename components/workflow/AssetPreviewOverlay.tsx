import React from 'react';

import { ImagePreviewOverlay, type ImagePreviewOverlayProps } from '../ImagePreviewOverlay';

export type AssetPreviewOverlayProps = ImagePreviewOverlayProps & {
  /**
   * Productized asset preview bridge.
   *
   * Image assets still use the mature image preview engine. Non-image assets
   * enter this canvas slot so their viewers no longer need to impersonate an
   * image lightbox or draw a second modal shell.
   */
  assetCanvasClassName?: string;
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
  ...props
}) => {
  const assetCenterSlot = centerSlot ? (
    <AssetPreviewCanvas className={assetCanvasClassName}>{centerSlot}</AssetPreviewCanvas>
  ) : undefined;

  const imagePreviewProps: ImagePreviewOverlayProps = {
    ...(props as ImagePreviewOverlayProps),
    centerSlot: assetCenterSlot,
  };

  return <ImagePreviewOverlay {...imagePreviewProps} />;
};
