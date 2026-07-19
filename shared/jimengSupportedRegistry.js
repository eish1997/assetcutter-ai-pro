/**
 * Jimeng supported SKU -> upstream req_key.
 *
 * "supported" means the product catalog knows how to submit this SKU to the
 * Volcengine Visual API. It is broader than the owner-smoke-tested
 * "verified" set.
 */

/** @type {Readonly<Record<string, { reqKey: string; modality: 'image' | 'video' | 'digital_human' }>>} */
export const JIMENG_SUPPORTED_REQ_KEY_BY_REGISTRY = Object.freeze({
  'jimeng-image-t2i-v40': { reqKey: 'jimeng_t2i_v40', modality: 'image' },
  'jimeng-image-t2i-v30': { reqKey: 'jimeng_t2i_v30', modality: 'image' },
  'jimeng-image-t2i-v31': { reqKey: 'jimeng_t2i_v31', modality: 'image' },
  'jimeng-video-ti2v-v30-pro': { reqKey: 'jimeng_ti2v_v30_pro', modality: 'video' },
});

/**
 * @param {string} registryId
 * @returns {{ reqKey: string; modality: 'image' | 'video' | 'digital_human' } | null}
 */
export function resolveSupportedJimengReqKey(registryId) {
  const id = String(registryId || '').trim();
  if (!id) return null;
  return JIMENG_SUPPORTED_REQ_KEY_BY_REGISTRY[id] ?? null;
}
