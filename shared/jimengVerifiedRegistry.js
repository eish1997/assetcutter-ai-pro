/**
 * 即梦 verified SKU → upstream req_key（§3 门禁真源，供 server 与 catalog 单测对齐）。
 * 完整 catalog 见 services/jimeng/catalog.ts；W0 服务端仅接受 verified registryId。
 */

/** @type {Readonly<Record<string, { reqKey: string; modality: 'image' | 'video' | 'digital_human' }>>} */
export const JIMENG_VERIFIED_REQ_KEY_BY_REGISTRY = Object.freeze({
  'jimeng-image-t2i-v40': { reqKey: 'jimeng_t2i_v40', modality: 'image' },
  'jimeng-video-ti2v-v30-pro': { reqKey: 'jimeng_ti2v_v30_pro', modality: 'video' },
});

/**
 * @param {string} registryId
 * @returns {{ reqKey: string; modality: 'image' | 'video' | 'digital_human' } | null}
 */
export function resolveVerifiedJimengReqKey(registryId) {
  const id = String(registryId || '').trim();
  if (!id) return null;
  return JIMENG_VERIFIED_REQ_KEY_BY_REGISTRY[id] ?? null;
}
