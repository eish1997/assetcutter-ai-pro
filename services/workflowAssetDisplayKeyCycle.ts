/** Q/E 在 resultOrder 版本链上步进 displayKey；delta>0 下一张，delta<0 上一张 */
export function stepDisplayKeyInOrder(
  keys: readonly string[],
  currentKey: string,
  delta: number
): string | null {
  if (keys.length <= 1) return null;
  let idx = keys.indexOf(currentKey);
  if (idx < 0) idx = 0;
  const nextIdx = (idx + (delta > 0 ? 1 : -1) + keys.length) % keys.length;
  const nextKey = keys[nextIdx];
  return nextKey === currentKey ? null : nextKey ?? null;
}

/** 连续按键模拟：每步基于上一步结果，避免闭包 stale state 导致同向连跳 */
export function stepDisplayKeyRepeated(
  keys: readonly string[],
  startKey: string,
  deltas: readonly number[]
): string {
  let current = startKey;
  for (const delta of deltas) {
    const next = stepDisplayKeyInOrder(keys, current, delta);
    if (next) current = next;
  }
  return current;
}
