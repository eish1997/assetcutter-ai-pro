import { readLocalString, removeLocalKey, writeLocalString } from './clientPersist';

const STORAGE_KEY = 'ac_companion_local_base_v1';
const TOKEN_KEY = 'ac_companion_local_token_v1';

const DEFAULT_BASE = 'http://127.0.0.1:18765';

function normalizeCompanionSharedToken(raw: string | null | undefined): string {
  if (raw == null) return '';
  return String(raw)
    .replace(/\uFEFF/g, '')
    .replace(/\r?\n/g, '')
    .trim();
}

export function normalizeCompanionBaseUrl(raw: string): string {
  const t = raw.trim().replace(/\/$/, '');
  return t || DEFAULT_BASE;
}

/** 网站设置里配置的「本地伴侣 HTTP 根」（仅本机探测用） */
export function getCompanionLocalBaseUrl(): string {
  const raw = readLocalString(STORAGE_KEY)?.trim();
  return normalizeCompanionBaseUrl(raw || DEFAULT_BASE);
}

export function setCompanionLocalBaseUrl(url: string): void {
  writeLocalString(STORAGE_KEY, normalizeCompanionBaseUrl(url));
}

/** 与宿主 `COMPANION_SHARED_TOKEN` 对齐；网站侧 `Authorization: Bearer`（见 `companionFetchJson`）。 */
export function getCompanionLocalToken(): string {
  return normalizeCompanionSharedToken(readLocalString(TOKEN_KEY));
}

export function setCompanionLocalToken(token: string): void {
  const t = normalizeCompanionSharedToken(token);
  if (!t) {
    removeLocalKey(TOKEN_KEY);
    return;
  }
  writeLocalString(TOKEN_KEY, t);
}
