import React from 'react';

import { ImagePreviewOverlay, type ImagePreviewOverlayProps } from '../ImagePreviewOverlay';

export type AssetPreviewOverlayProps = ImagePreviewOverlayProps;

/**
 * Transition shell for multi-type asset preview.
 *
 * Round 3 keeps the existing image preview engine intact, while callers switch
 * to the asset-oriented shell name. Later rounds can move type-specific
 * viewers here without changing WorkflowSection's top-level preview contract.
 */
export const AssetPreviewOverlay: React.FC<AssetPreviewOverlayProps> = (props) => (
  <ImagePreviewOverlay {...props} />
);

