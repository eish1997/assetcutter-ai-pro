import { readLocalString, writeLocalString } from './clientPersist';

/** 本机用户界面偏好（侧栏头像等），存 localStorage；不参与服务端账户；读写经 `clientPersist` */

const STORAGE_KEY = 'ac_user_ui_prefs_v1';
const DISPLAY_NAME_MAX = 24;
/** data URL 过长会挤爆 localStorage；约 320KB 量级 */
export const MAX_AVATAR_DATA_URL_CHARS = 420_000;

export type UserUiPrefs = {
  /** 侧栏等处的展示名，空则用账户用户名 */
  displayName: string;
  /** data:image/* 或 https 图片地址；空则用渐变缩写头像 */
  avatarUrl: string;
};

/** 空偏好单例：useSyncExternalStore 要求 getSnapshot 在数据未变时保持同一引用 */
const EMPTY_PREFS = Object.freeze({
  displayName: '',
  avatarUrl: '',
});

const listeners = new Set<() => void>();

/** 与 localStorage 当前字符串同步，避免每次 getSnapshot 返回新对象导致无限渲染 */
let cachedRaw: string | undefined;
let cachedPrefs: UserUiPrefs | undefined;

function invalidateCache() {
  cachedRaw = undefined;
  cachedPrefs = undefined;
}

function notify() {
  listeners.forEach((cb) => {
    try {
      cb();
    } catch {
      /* ignore */
    }
  });
}

export function subscribeUserUiPrefs(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

/** 仅允许安全图片 src：data:image/* 或 http(s)（禁止 localhost 持久化） */
export function sanitizeAvatarUrl(raw: string): string {
  const t = String(raw || '').trim();
  if (!t) return '';
  if (/^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(t)) {
    if (t.length > MAX_AVATAR_DATA_URL_CHARS) return '';
    return t;
  }
  if (/^https:\/\//i.test(t)) {
    try {
      const u = new URL(t);
      if (/^(127\.0\.0\.1|localhost)$/i.test(u.hostname)) return '';
      return t;
    } catch {
      return '';
    }
  }
  if (/^http:\/\//i.test(t)) {
    try {
      const u = new URL(t);
      if (/^(127\.0\.0\.1|localhost)$/i.test(u.hostname)) return '';
      return t;
    } catch {
      return '';
    }
  }
  return '';
}

function buildPrefsFromRaw(raw: string): UserUiPrefs {
  if (!raw) return EMPTY_PREFS;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const displayName = typeof o.displayName === 'string' ? o.displayName.slice(0, DISPLAY_NAME_MAX).trim() : '';
    const avatarUrl = typeof o.avatarUrl === 'string' ? sanitizeAvatarUrl(o.avatarUrl.trim()) : '';
    if (!displayName && !avatarUrl) return EMPTY_PREFS;
    return Object.freeze({ displayName, avatarUrl });
  } catch {
    return EMPTY_PREFS;
  }
}

export function getUserUiPrefs(): UserUiPrefs {
  const raw = readLocalString(STORAGE_KEY) ?? '';
  if (cachedRaw === raw && cachedPrefs !== undefined) return cachedPrefs;
  cachedRaw = raw;
  cachedPrefs = buildPrefsFromRaw(raw);
  return cachedPrefs;
}

export function setUserUiPrefs(patch: Partial<UserUiPrefs>): void {
  const cur = getUserUiPrefs();
  const nextPlain: UserUiPrefs = {
    displayName:
      patch.displayName !== undefined
        ? String(patch.displayName).slice(0, DISPLAY_NAME_MAX).trim()
        : cur.displayName,
    avatarUrl: patch.avatarUrl !== undefined ? sanitizeAvatarUrl(patch.avatarUrl) : cur.avatarUrl,
  };
  writeLocalString(STORAGE_KEY, JSON.stringify(nextPlain));
  invalidateCache();
  notify();
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) {
      invalidateCache();
      notify();
    }
  });
}
