export const RESULT_VER_SEP = '__v__';

/** 大图「改尺寸写回」：result key 基底（非 capability 预设 id） */
export const WORKFLOW_LIGHTBOX_RESIZE_WRITEBACK_ACTION_ID = 'ac_internal_lightbox_resize_writeback';
/** 大图「线分割变形」单独写回：result key 基底 */
export const WORKFLOW_LIGHTBOX_SPLIT_STRETCH_WRITEBACK_ACTION_ID =
  'ac_internal_lightbox_split_stretch_writeback';

export const uuid = () => Math.random().toString(36).slice(2, 11);

export const baseActionId = (k: string) => (k.includes(RESULT_VER_SEP) ? k.split(RESULT_VER_SEP)[0]! : k);

/**
 * 解析结果槽位 key 对应的能力 id：`__v__` 与 {@link baseActionId} 一致；
 * 另兼容历史/异常键名中的 `_v_<suffix>`（如 `_v_mov64bye`），避免模块表匹配失败而露出原始 key。
 */
export const stripResultKeyToBaseActionId = (k: string): string => {
  const fromSep = baseActionId(k);
  if (fromSep !== k) return fromSep;
  const m = /^(.+)_v_[a-z0-9]+$/i.exec(k);
  return m?.[1] ?? k;
};

export const makeVersionKey = (baseId: string) => `${baseId}${RESULT_VER_SEP}${Date.now().toString(36)}`;

/** 判断资产上是否已有同能力的结果槽（图/文/3D/meta/order）。 */
export function assetHasResultVersionForBase(
  asset: {
    resultOrder?: string[];
    results?: Record<string, unknown>;
    textResults?: Record<string, unknown>;
    stepModelUrls?: Record<string, unknown>;
    stepModelCompanionKeys?: Record<string, unknown>;
    resultMeta?: Record<string, unknown>;
  },
  baseId: string
): boolean {
  const base = String(baseId || '').trim();
  if (!base) return false;
  const match = (k: string) => baseActionId(k) === base;
  if ((asset.resultOrder || []).some(match)) return true;
  if (Object.keys(asset.results || {}).some(match)) return true;
  if (Object.keys(asset.textResults || {}).some(match)) return true;
  if (Object.keys(asset.stepModelUrls || {}).some(match)) return true;
  if (Object.keys(asset.stepModelCompanionKeys || {}).some(match)) return true;
  if (Object.keys(asset.resultMeta || {}).some(match)) return true;
  return false;
}

/** 同能力首次写回用裸 baseId；再次生成则 `__v__` 追加新版本（对齐图片）。 */
export function allocateWorkflowResultVersionKey(
  asset: Parameters<typeof assetHasResultVersionForBase>[0],
  baseId: string
): string {
  const base = String(baseId || '').trim();
  if (!base) return base;
  return assetHasResultVersionForBase(asset, base) ? makeVersionKey(base) : base;
}
