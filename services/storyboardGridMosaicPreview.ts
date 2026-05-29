import type { StoryboardParseFieldDef } from '../types';
import type { StoryboardDurationGroup } from './storyboardGridDurationGroups';
import {
  renderStoryboardGroupMosaicDataUrl,
  storyboardGroupMosaicExportCacheKey,
} from './storyboardFrameStripMerge';

const previewCache = new Map<string, string>();
const PREVIEW_CACHE_MAX = 12;

/** 离屏合成组拼图预览（与导出一致，带内存缓存） */
export async function renderStoryboardGroupMosaicPreview(
  group: StoryboardDurationGroup,
  fieldCatalog: StoryboardParseFieldDef[],
  previewWidth: number
): Promise<string | null> {
  const cacheKey = storyboardGroupMosaicExportCacheKey(group, fieldCatalog, previewWidth);
  const cached = previewCache.get(cacheKey);
  if (cached) return cached;

  const width = Math.max(960, Math.round(previewWidth));
  const dataUrl = await renderStoryboardGroupMosaicDataUrl(group, fieldCatalog, {
    width,
    height: Math.round((width * 3) / 4),
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
