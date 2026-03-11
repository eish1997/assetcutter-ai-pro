/** 用户设置的 API 密钥存 localStorage，键名与读写逻辑集中在此 */

const STORAGE_KEY_GEMINI = 'ac_gemini_api_key';
const SESSION_KEY_TENCENT_SECRET_ID = 'ac_tencent_secret_id';
const SESSION_KEY_TENCENT_SECRET_KEY = 'ac_tencent_secret_key';

function getSessionStorage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

// ----- Gemini -----
export function getUserApiKey(): string | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY_GEMINI);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

export function setUserApiKey(value: string | null): void {
  try {
    if (value == null || !value.trim()) {
      localStorage.removeItem(STORAGE_KEY_GEMINI);
    } else {
      localStorage.setItem(STORAGE_KEY_GEMINI, value.trim());
    }
  } catch {
    // ignore
  }
}

/**
 * 供 geminiService 使用：仅返回用户在当前浏览器中保存的 Gemini API Key。
 * 不再回退到构建时注入的环境变量，避免把站点运营密钥暴露到前端产物。
 */
export function getApiKey(): string | undefined {
  const user = getUserApiKey();
  if (user) return user;
  return undefined;
}

// ----- 混元（腾讯云） -----
export function getTencentSecretId(): string | null {
  try {
    const v = getSessionStorage()?.getItem(SESSION_KEY_TENCENT_SECRET_ID);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

export function setTencentSecretId(value: string | null): void {
  try {
    const storage = getSessionStorage();
    if (!storage) return;
    if (value == null || !value.trim()) {
      storage.removeItem(SESSION_KEY_TENCENT_SECRET_ID);
    } else {
      storage.setItem(SESSION_KEY_TENCENT_SECRET_ID, value.trim());
    }
  } catch {
    // ignore
  }
}

export function getTencentSecretKey(): string | null {
  try {
    const v = getSessionStorage()?.getItem(SESSION_KEY_TENCENT_SECRET_KEY);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

export function setTencentSecretKey(value: string | null): void {
  try {
    const storage = getSessionStorage();
    if (!storage) return;
    if (value == null || !value.trim()) {
      storage.removeItem(SESSION_KEY_TENCENT_SECRET_KEY);
    } else {
      storage.setItem(SESSION_KEY_TENCENT_SECRET_KEY, value.trim());
    }
  } catch {
    // ignore
  }
}

/**
 * 供 tencentService 使用：仅返回当前浏览器会话中的临时混元凭证。
 * 默认不再把腾讯云密钥持久化到 localStorage，避免长期滞留在浏览器。
 */
export function getTencentCreds(): { secretId: string; secretKey: string } {
  const userSecretId = getTencentSecretId();
  const userSecretKey = getTencentSecretKey();
  const secretId = (userSecretId || '').trim();
  const secretKey = (userSecretKey || '').trim();
  return { secretId, secretKey };
}

// ----- 能力商店（远程预设 Catalog URL）-----
const STORAGE_KEY_CAPABILITY_STORE_URL = 'ac_store_catalog_url';

/** 默认能力预设商店目录（GitHub raw 避免 CDN 强缓存，保证能看到最新包列表） */
export const DEFAULT_CAPABILITY_STORE_CATALOG_URL =
  (typeof import.meta !== 'undefined' && (import.meta as unknown as { env?: Record<string, string> })?.env?.VITE_STORE_CATALOG_URL) ||
  'https://raw.githubusercontent.com/eish1997/assetcutter-ai-pro-store/main/store/catalog.json';

/** 已废弃的 jsDelivr 默认地址（强缓存导致只看到 1 个包），迁移到 raw 地址 */
const DEPRECATED_JSDELIVR_CATALOG_URL = 'https://cdn.jsdelivr.net/gh/eish1997/assetcutter-ai-pro-store@main/store/catalog.json';

export function getCapabilityStoreCatalogUrl(): string {
  try {
    let v = localStorage.getItem(STORAGE_KEY_CAPABILITY_STORE_URL);
    v = v && v.trim() ? v.trim() : '';
    if (v === DEPRECATED_JSDELIVR_CATALOG_URL) {
      localStorage.removeItem(STORAGE_KEY_CAPABILITY_STORE_URL);
      return DEFAULT_CAPABILITY_STORE_CATALOG_URL;
    }
    return v || DEFAULT_CAPABILITY_STORE_CATALOG_URL;
  } catch {
    return DEFAULT_CAPABILITY_STORE_CATALOG_URL;
  }
}

export function setCapabilityStoreCatalogUrl(value: string | null): void {
  try {
    if (value == null || !value.trim()) {
      localStorage.removeItem(STORAGE_KEY_CAPABILITY_STORE_URL);
    } else {
      localStorage.setItem(STORAGE_KEY_CAPABILITY_STORE_URL, value.trim());
    }
  } catch {
    // ignore
  }
}
