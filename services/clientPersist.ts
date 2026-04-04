/**
 * 客户端持久化单一范式（浏览器）
 *
 * **分层**
 * - `sessionStorage`：仅当前标签页；可丢、偏临时（如瀑布卡片比例缓存）。
 * - `localStorage`：设备级偏好与缓存；**按账号隔离**时用 `scopedStorageKey`（`…__guest` / `…__u_${scope}`）。
 * - **工作区画布 / 项目 / 对话**：业务编排仍在 `workspaceProjectStore`、`dialogSessionStore` 等模块；其对 local 的读写须经本文件的 API（含 `writeLocalStringOrThrow` 等），云同步另见 `workspaceCloudSync`。
 *
 * **约定**
 * - 所有读写经本模块的 safe 包装（try/catch、无 window 时短路）。
 * - 键名集中声明：`STORAGE_*` 或业务 store 内常量；避免散落魔法字符串。
 * - 与跨设备规则一致：持久化值勿写死不可达 origin（见 `cross-device-availability`）。
 */

type GlobalWithWebStorage = typeof globalThis & { localStorage?: Storage; sessionStorage?: Storage };

/** 与历史逻辑一致：用 `globalThis`，便于测试里对 `globalThis.sessionStorage` 打桩（不必依赖 `window`） */
export function safeLocalStorage(): Storage | null {
  try {
    const st = (globalThis as GlobalWithWebStorage).localStorage;
    return st ?? null;
  } catch {
    return null;
  }
}

export function safeSessionStorage(): Storage | null {
  try {
    const st = (globalThis as GlobalWithWebStorage).sessionStorage;
    return st ?? null;
  } catch {
    return null;
  }
}

/** `preferenceScope` 为空或未传时用 `__guest`，否则 `__u_${trim(scope)}` */
export function scopedStorageKey(baseKey: string, preferenceScope: string | null | undefined): string {
  const s = String(preferenceScope ?? '').trim();
  return s ? `${baseKey}__u_${s}` : `${baseKey}__guest`;
}

// ----- local: string / flag -----

export function readLocalString(key: string): string | null {
  const st = safeLocalStorage();
  if (!st) return null;
  try {
    const v = st.getItem(key);
    return v;
  } catch {
    return null;
  }
}

export function writeLocalString(key: string, value: string): void {
  const st = safeLocalStorage();
  if (!st) return;
  try {
    st.setItem(key, value);
  } catch {
    /* quota */
  }
}

/**
 * 与原生 `localStorage.setItem` 一致：存储不可用或写入失败时抛出，便于调用方识别 `QuotaExceededError` 等。
 */
export function writeLocalStringOrThrow(key: string, value: string): void {
  const st = safeLocalStorage();
  if (!st) {
    throw new Error('localStorage unavailable');
  }
  st.setItem(key, value);
}

export function removeLocalKey(key: string): void {
  const st = safeLocalStorage();
  if (!st) return;
  try {
    st.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** 读取并 trim；空串或仅空白视为 `null`（键不存在亦为 `null`） */
export function readLocalNonEmptyTrimmed(key: string): string | null {
  const v = readLocalString(key);
  const t = v != null ? v.trim() : '';
  return t ? t : null;
}

/** 非空则 trim 后写入，否则删除键（用于 API Key 等可清空项） */
export function writeLocalNonEmptyTrimmedOrRemove(key: string, value: string | null | undefined): void {
  const t = value == null ? '' : String(value).trim();
  if (!t) removeLocalKey(key);
  else writeLocalString(key, t);
}

export function readLocalFlag(key: string): boolean {
  return readLocalString(key) === '1';
}

export function writeLocalFlag(key: string, on: boolean): void {
  if (!on) {
    removeLocalKey(key);
    return;
  }
  writeLocalString(key, '1');
}

// ----- local: JSON -----

export function readLocalJson<T>(key: string, fallback: T, normalize?: (parsed: unknown) => T | null): T {
  const raw = readLocalString(key);
  if (raw == null || raw === '') return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (normalize) {
      const n = normalize(parsed);
      return n == null ? fallback : n;
    }
    return parsed as T;
  } catch {
    return fallback;
  }
}

export function writeLocalJson(key: string, value: unknown): void {
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch {
    return;
  }
  writeLocalString(key, encoded);
}

export function isStringArray(x: unknown): x is string[] {
  return Array.isArray(x) && x.every((i) => typeof i === 'string');
}

// ----- session: JSON -----

export function readSessionString(key: string): string | null {
  const st = safeSessionStorage();
  if (!st) return null;
  try {
    return st.getItem(key);
  } catch {
    return null;
  }
}

export function writeSessionString(key: string, value: string): void {
  const st = safeSessionStorage();
  if (!st) return;
  try {
    st.setItem(key, value);
  } catch {
    /* quota */
  }
}

export function removeSessionKey(key: string): void {
  const st = safeSessionStorage();
  if (!st) return;
  try {
    st.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function readSessionNonEmptyTrimmed(key: string): string | null {
  const v = readSessionString(key);
  const t = v != null ? v.trim() : '';
  return t ? t : null;
}

export function writeSessionNonEmptyTrimmedOrRemove(key: string, value: string | null | undefined): void {
  const t = value == null ? '' : String(value).trim();
  if (!t) removeSessionKey(key);
  else writeSessionString(key, t);
}

export function readSessionJson<T>(key: string, fallback: T, normalize?: (parsed: unknown) => T | null): T {
  const raw = readSessionString(key);
  if (raw == null || raw === '') return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (normalize) {
      const n = normalize(parsed);
      return n == null ? fallback : n;
    }
    return parsed as T;
  } catch {
    return fallback;
  }
}

export function writeSessionJson(key: string, value: unknown): void {
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch {
    return;
  }
  writeSessionString(key, encoded);
}

/** 工作流侧栏「常用功能」预设 id 列表（local，按 `preferenceScope` 分键） */
export const STORAGE_WORKFLOW_FAVORITES_V1 = 'ac_workflow_favorites_v1';

export function workflowFavoritesStorageKey(preferenceScope: string | null | undefined): string {
  return scopedStorageKey(STORAGE_WORKFLOW_FAVORITES_V1, preferenceScope);
}
