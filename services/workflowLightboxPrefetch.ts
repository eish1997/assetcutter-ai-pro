import { workflowSafeImgSrc } from './workflowImageDisplay';

const prefetchedSrcKeys = new Set<string>();

/** 悬停预取大图 URL，点击开预览时 often 已进浏览器缓存 */
export function prefetchWorkflowLightboxImage(rawSrc: string | undefined | null): void {
  const safe = workflowSafeImgSrc(rawSrc).trim();
  if (!safe || prefetchedSrcKeys.has(safe)) return;
  prefetchedSrcKeys.add(safe);
  const img = new Image();
  img.decoding = 'async';
  try {
    (img as HTMLImageElement & { fetchPriority?: string }).fetchPriority = 'low';
  } catch {
    /* ignore */
  }
  img.src = safe;
}
