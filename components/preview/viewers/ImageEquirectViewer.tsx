/**
 * 全景 Viewer：单独 chunk，供 registry 懒加载，避免未开全景时拉取 Three 相关依赖链。
 */
import React from 'react';
import { EquirectangularPanoramaCanvas } from '../../EquirectangularPanoramaCanvas';

export type ImageEquirectViewerProps = {
  imageSrc: string;
  className?: string;
};

const ImageEquirectViewer: React.FC<ImageEquirectViewerProps> = ({ imageSrc, className }) => (
  <EquirectangularPanoramaCanvas imageSrc={imageSrc} className={className ?? ''} />
);

export default ImageEquirectViewer;
