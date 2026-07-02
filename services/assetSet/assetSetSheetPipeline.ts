import type { BoundingBox } from '../../types';
import type { AssetSetComponentView } from '../../types';
import { cropBoxes } from '../imageCrop';
import {
  detectStoryboardSheetPanels,
  sortStoryboardSheetBoxesReadingOrder,
} from '../storyboardSheetVisionSplit';
import { ASSET_SET_DEFAULT_VIEW_ROLES } from './assetSetPresets';

const viewId = () => Math.random().toString(36).slice(2, 11);

export async function splitAssetSetSheetToViews(
  sheetDataUrl: string,
  inputBoxes?: BoundingBox[]
): Promise<{ views: AssetSetComponentView[]; boxes: BoundingBox[]; warn?: string }> {
  let boxes = inputBoxes?.length ? [...inputBoxes] : [];
  let warn: string | undefined;
  if (!boxes.length) {
    try {
      boxes = await detectStoryboardSheetPanels(
        sheetDataUrl,
        ASSET_SET_DEFAULT_VIEW_ROLES.map((_, i) => String(i + 1))
      );
    } catch (e) {
      return {
        views: [],
        boxes: [],
        warn: e instanceof Error ? e.message : '未能识别多视角格子',
      };
    }
    if (!boxes.length) {
      return { views: [], boxes: [], warn: warn || '未能识别多视角格子' };
    }
  }
  const ordered = sortStoryboardSheetBoxesReadingOrder(boxes);
  const crops = await cropBoxes(
    sheetDataUrl,
    ordered,
    ordered.map((_, i) => i),
    2
  );
  const views: AssetSetComponentView[] = [];
  ordered.forEach((box, index) => {
    const image = crops[index];
    if (!image) return;
    views.push({
      id: viewId(),
      role: ASSET_SET_DEFAULT_VIEW_ROLES[index] ?? `view_${index + 1}`,
      image,
    });
  });
  return { views, boxes: ordered, warn };
}
