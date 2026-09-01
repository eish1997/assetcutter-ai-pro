export type WorkspaceAssetLike = {
  id: string;
  [key: string]: unknown;
};

export type WorkspaceAssetUpsertPayload = {
  id: string;
  [key: string]: unknown;
};

export function mergeAssetUpsert<T extends WorkspaceAssetLike>(
  assets: T[] | null | undefined,
  payload: WorkspaceAssetUpsertPayload | null | undefined,
): T[] {
  const list = Array.isArray(assets) ? assets.slice() : [];
  const id = String(payload?.id || '').trim();
  if (!id || !payload) return list;
  const patch = { ...payload, id };
  const idx = list.findIndex((a) => String(a?.id || '') === id);
  if (idx < 0) {
    return [{ ...(patch as T) }, ...list];
  }
  const next = list.slice();
  next[idx] = { ...next[idx], ...patch, id } as T;
  return next;
}

export function removeAssetById<T extends WorkspaceAssetLike>(
  assets: T[] | null | undefined,
  assetId: string | null | undefined,
): T[] {
  const list = Array.isArray(assets) ? assets : [];
  const id = String(assetId || '').trim();
  if (!id) return list.slice();
  const next = list.filter((a) => String(a?.id || '') !== id);
  return next.length === list.length ? list : next;
}
