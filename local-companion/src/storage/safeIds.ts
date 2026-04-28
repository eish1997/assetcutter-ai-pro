/** 项目 / 资源 key 仅允许安全片段，防路径穿越。 */
const SAFE = /^[a-zA-Z0-9]([a-zA-Z0-9._-]{0,126})$/;

export function isSafeIdPart(s: string | undefined): s is string {
  if (!s || s.length > 128) return false;
  if (s.includes('..') || s.includes('/') || s.includes('\\')) return false;
  return SAFE.test(s);
}

export function assertSafeId(s: string | undefined, name: string): string {
  if (!isSafeIdPart(s)) throw new Error(`invalid_${name}`);
  return s;
}
