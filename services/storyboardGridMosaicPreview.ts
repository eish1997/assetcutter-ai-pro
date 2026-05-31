import type { StoryboardParseFieldDef } from '../types';
import type { StoryboardDurationGroup } from './storyboardGridDurationGroups';
import {
  renderStoryboardGroupMosaicDataUrl,
  storyboardGroupMosaicExportCacheKey,
} from './storyboardFrameStripMerge';

const previewCache = new Map<string, string>();
const PREVIEW_CACHE_MAX = 12;
/** 布局算法变更时递增，避免旧缓存字号/留白/行高 */
const MOSAIC_PREVIEW_LAYOUT_VERSION = 9;

/** 离屏合成组拼图预览（与导出一致，带内存缓存） */
export async function renderStoryboardGroupMosaicPreview(
  group: StoryboardDurationGroup,
  fieldCatalog: StoryboardParseFieldDef[],
  previewWidth: number
): Promise<string | null> {
  const cacheKey = `${MOSAIC_PREVIEW_LAYOUT_VERSION}:${storyboardGroupMosaicExportCacheKey(group, fieldCatalog, previewWidth)}`;
  const cached = previewCache.get(cacheKey);
  if (cached) return cached;

  const width = Math.max(960, Math.round(previewWidth));
  const dataUrl = await renderStoryboardGroupMosaicDataUrl(group, fieldCatalog, {
    width,
    jpegQuality: 0.9,
  });
  if (dataUrl) {
    if (previewCache.size >= PREVIEW_CACHE_MAX) {
      const oldest = previewCache.keys().next().value;
      if (oldest) previewCache.delete(oldest);
    }
    previewCache.set(cacheKey, dataUrl);
  }
  return dataUrl;
}

export function clearStoryboardGridMosaicPreviewCache(): void {
  previewCache.clear();
}
