import { sanitizeCompanionPathSegment } from './workflowCompanionAssets';

/**
 * 本地伴侣 object key：单段、无 `/`，与 `local-companion` `isSafeIdPart` 一致。
 */
export function companionOcrAssetKey(
  role: 'upload' | 'result' | 'markdown' | 'img' | 'pdf',
  stamp: number,
  nameHint?: string,
): string {
  const hint = nameHint ? sanitizeCompanionPathSegment(nameHint) : 'file';
  return `ocr-${role}-${stamp}-${hint}`.slice(0, 128);
}

export function isCompanionSafeAssetKey(key: string): boolean {
  if (!key || key.length > 128) return false;
  if (key.includes('/') || key.includes('\\') || key.includes('..')) return false;
  return /^[a-zA-Z0-9]([a-zA-Z0-9._-]{0,126})$/.test(key);
}
