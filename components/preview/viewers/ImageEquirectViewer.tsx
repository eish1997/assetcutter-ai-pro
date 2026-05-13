/**
 * 全景 Viewer：单独 chunk，供 registry 懒加载，避免未开全景时拉取 Three 相关依赖链。
 */
import React, { forwardRef } from 'react';
import { EquirectangularPanoramaCanvas } from '../../EquirectangularPanoramaCanvas';
import type { PanoramaViewportProjection } from '../../../services/panoViewportProjection';

export type ImageEquirectViewerProps = {
  imageSrc: string;
  className?: string;
  panoPreserveViewKey?: string;
};

const ImageEquirectViewer = forwardRef<PanoramaViewportProjection | null, ImageEquirectViewerProps>(
  function ImageEquirectViewer({ imageSrc, className, panoPreserveViewKey }, ref) {
    return (
      <EquirectangularPanoramaCanvas
        ref={ref}
        imageSrc={imageSrc}
        className={className ?? ''}
        preserveViewKey={panoPreserveViewKey}
      />
    );
  }
);

export default ImageEquirectViewer;
