import { mapSiteR2PathToFetchUrl, resolveCapabilityPreviewSrc } from './capabilityPreviewUrl';
import type { StoryboardTableRow } from '../types';

/** 分镜图在 `<img>` / canvas 中使用的可请求地址 */
export function resolveStoryboardFrameDisplaySrc(
  frameImage?: string | null,
  frameImageObjectKey?: string | null
): string | undefined {
  const img = String(frameImage || '').trim();
  if (img) {
    if (img.startsWith('data:') || img.startsWith('blob:')) return img;
    if (typeof window === 'undefined') return img;
    return resolveCapabilityPreviewSrc(img) ?? img;
  }

  const objectKey = String(frameImageObjectKey || '').trim();
  if (!objectKey) return undefined;

  const sitePath = objectKey.startsWith('/api/')
    ? objectKey
    : `/api/r2/objects/${objectKey}`;
  return mapSiteR2PathToFetchUrl(sitePath);
}

export function storyboardRowHasFrameRef(
  row: Pick<StoryboardTableRow, 'frameImage' | 'frameImageObjectKey' | 'frameImageCompanionKey'>
): boolean {
  if (String(row.frameImage || '').trim()) return true;
  if (String(row.frameImageObjectKey || '').trim()) return true;
  if (String(row.frameImageCompanionKey || '').trim()) return true;
  return false;
}

/** 同步解析行内分镜图（伴侣键需先 hydrate 为 blob:） */
export function resolveStoryboardRowFrameDisplaySrc(
  row: Pick<StoryboardTableRow, 'frameImage' | 'frameImageObjectKey'>
): string {
  return resolveStoryboardFrameDisplaySrc(row.frameImage, row.frameImageObjectKey) || '';
}
