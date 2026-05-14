import type { ImageOverlayAnnotationDoc } from '../types';

/** 超过则不做逐字节比较，避免关大图时主线程长时间阻塞 */
const MAX_OVERLAY_JSON_COMPARE_BYTES = 400_000;

export type OverlayDraftDirtyVerdict = 'clean' | 'dirty' | 'unknown';

/**
 * 比较「大图内存态」与「资产上已持久化」的 flat/pano 两桶是否一致（§10 关窗 diff 的读侧）。
 * 序列化异常或体积过大时返回 **`unknown`**，调用方应 **默认走安全路径**（通常仍 flush）。
 */
export function compareWorkflowOverlayDraftToPersisted(params: {
  draftFlat: ImageOverlayAnnotationDoc;
  draftPano: ImageOverlayAnnotationDoc;
  storedFlat: ImageOverlayAnnotationDoc;
  storedPano: ImageOverlayAnnotationDoc;
}): OverlayDraftDirtyVerdict {
  try {
    const sf = JSON.stringify(params.draftFlat);
    const sp = JSON.stringify(params.draftPano);
    const tf = JSON.stringify(params.storedFlat);
    const tp = JSON.stringify(params.storedPano);
    if (
      sf.length > MAX_OVERLAY_JSON_COMPARE_BYTES ||
      sp.length > MAX_OVERLAY_JSON_COMPARE_BYTES ||
      tf.length > MAX_OVERLAY_JSON_COMPARE_BYTES ||
      tp.length > MAX_OVERLAY_JSON_COMPARE_BYTES
    ) {
      return 'unknown';
    }
    const same = sf === tf && sp === tp;
    return same ? 'clean' : 'dirty';
  } catch {
    return 'unknown';
  }
}
