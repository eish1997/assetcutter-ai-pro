import type { AssetSetComponent, BoundingBox } from '../../types';
import { cropBoxes } from '../imageCrop';
import { newStoryboardSheetSplitBoxId } from '../storyboardSheetVisionSplit';
import { createAssetSetComponent, defaultAssetSetComponentName } from './assetSetAsset';

export async function deriveCropPreviewFromRegion(
  styledImageDataUrl: string,
  region: BoundingBox
): Promise<string> {
  const crops = await cropBoxes(styledImageDataUrl, [region], [0], 4);
  return crops[0] || '';
}

export function buildAssetSetComponentsFromBoxes(
  boxes: BoundingBox[],
  existing: AssetSetComponent[] = []
): AssetSetComponent[] {
  const ordered = [...boxes];
  return ordered.map((box, index) => {
    const prev = existing[index];
    const region: BoundingBox = {
      id: box.id || prev?.cropRegion.id || newStoryboardSheetSplitBoxId(),
      label: box.label?.trim() || prev?.cropRegion.label || String(index + 1),
      xmin: box.xmin,
      ymin: box.ymin,
      xmax: box.xmax,
      ymax: box.ymax,
    };
    return createAssetSetComponent(
      {
        id: prev?.id,
        name: prev?.name || defaultAssetSetComponentName(index),
        cropRegion: region,
        cropSource: 'styled',
        views: prev?.views ?? [],
        model3d: prev?.model3d,
        locked: prev?.locked,
      },
      index
    );
  });
}

export async function applyCropPreviewsToComponents(
  styledImageDataUrl: string,
  components: AssetSetComponent[]
): Promise<AssetSetComponent[]> {
  if (!styledImageDataUrl.trim() || !components.length) return components;
  const boxes = components.map((c) => c.cropRegion);
  const crops = await cropBoxes(styledImageDataUrl, boxes, boxes.map((_, i) => i), 4);
  return components.map((component, index) => ({
    ...component,
    cropPreview: crops[index] || component.cropPreview,
  }));
}
