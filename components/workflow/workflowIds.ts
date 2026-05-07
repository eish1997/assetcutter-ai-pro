export const RESULT_VER_SEP = '__v__';

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
