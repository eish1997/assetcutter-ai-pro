/** 用户设置的 API 密钥存 localStorage，键名与读写逻辑集中在此 */

const STORAGE_KEY_GEMINI = 'ac_gemini_api_key';
const STORAGE_KEY_AI_PROVIDER = 'ac_ai_provider';
const STORAGE_KEY_TOAPIS_API_KEY = 'ac_toapis_api_key';
const STORAGE_KEY_TOAPIS_BASE_URL = 'ac_toapis_base_url';
const STORAGE_KEY_VECTORENGINE_API_KEY = 'ac_vectorengine_api_key';
const STORAGE_KEY_VECTORENGINE_BASE_URL = 'ac_vectorengine_base_url';
const STORAGE_KEY_DIALOG_SKIP_UNDERSTAND = 'ac_dialog_skip_understand';
const STORAGE_KEY_WORKSPACE_AUTO_SYNC = 'ac_workspace_auto_sync';

export type AiProvider = 'gemini' | 'toapis' | 'vectorengine';
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

export function getAiProvider(): AiProvider {
  try {
    const v = localStorage.getItem(STORAGE_KEY_AI_PROVIDER);
    if (v === 'toapis') return 'toapis';
    if (v === 'vectorengine') return 'vectorengine';
    return 'gemini';
  } catch {
    return 'gemini';
  }
}

export function setAiProvider(value: AiProvider): void {
  try {
    localStorage.setItem(STORAGE_KEY_AI_PROVIDER, value);
  } catch {
    // ignore
  }
}

export function getToapisApiKey(): string | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY_TOAPIS_API_KEY);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

export function setToapisApiKey(value: string | null): void {
  try {
    if (value == null || !value.trim()) {
      localStorage.removeItem(STORAGE_KEY_TOAPIS_API_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY_TOAPIS_API_KEY, value.trim());
    }
  } catch {
    // ignore
  }
}

/** ToAPIs 网关根路径，须含 /v1，如 https://toapis.com/v1 */
export function getToapisBaseUrl(): string {
  try {
    const v = localStorage.getItem(STORAGE_KEY_TOAPIS_BASE_URL);
    const t = v && v.trim() ? v.trim() : '';
    return t || 'https://toapis.com/v1';
  } catch {
    return 'https://toapis.com/v1';
  }
}

export function setToapisBaseUrl(value: string | null): void {
  try {
    if (value == null || !value.trim()) {
      localStorage.removeItem(STORAGE_KEY_TOAPIS_BASE_URL);
    } else {
      localStorage.setItem(STORAGE_KEY_TOAPIS_BASE_URL, value.trim());
    }
  } catch {
    // ignore
  }
}

export function getVectorengineApiKey(): string | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY_VECTORENGINE_API_KEY);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

export function setVectorengineApiKey(value: string | null): void {
  try {
    if (value == null || !value.trim()) {
      localStorage.removeItem(STORAGE_KEY_VECTORENGINE_API_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY_VECTORENGINE_API_KEY, value.trim());
    }
  } catch {
    // ignore
  }
}

/** 向量引擎根地址（不含 /v1beta 路径），如 https://api.vectorengine.ai */
export function getVectorengineBaseUrl(): string {
  try {
    const v = localStorage.getItem(STORAGE_KEY_VECTORENGINE_BASE_URL);
    const t = v && v.trim() ? v.trim() : '';
    return t || 'https://api.vectorengine.ai';
  } catch {
    return 'https://api.vectorengine.ai';
  }
}

export function setVectorengineBaseUrl(value: string | null): void {
  try {
    if (value == null || !value.trim()) {
      localStorage.removeItem(STORAGE_KEY_VECTORENGINE_BASE_URL);
    } else {
      localStorage.setItem(STORAGE_KEY_VECTORENGINE_BASE_URL, value.trim());
    }
  } catch {
    // ignore
  }
}

/** 当前选用供应商下的 API Key（Gemini 官方、ToAPIs 或 VectorEngine） */
export function getApiKey(): string | undefined {
  if (getAiProvider() === 'toapis') {
    const k = getToapisApiKey();
    return k ?? undefined;
  }
  if (getAiProvider() === 'vectorengine') {
    const k = getVectorengineApiKey();
    return k ?? undefined;
  }
  const user = getUserApiKey();
  if (user) return user;
  return undefined;
}

/**
 * 当前选用的 AI 供应商是否具备调用条件：
 * - ToAPIs / VectorEngine：本机已填 Key
 * - Gemini：本机 Key，或构建时配置了 VITE_BULK_IMAGE_API（走后端代理）
 */
export function isAiInvocationReady(): boolean {
  const p = getAiProvider();
  if (p === 'toapis') return Boolean(getToapisApiKey()?.trim());
  if (p === 'vectorengine') return Boolean(getVectorengineApiKey()?.trim());
  try {
    const env = typeof import.meta !== 'undefined' ? (import.meta as { env?: Record<string, string | undefined> }).env : undefined;
    const bulk = env?.VITE_BULK_IMAGE_API;
    if (bulk && String(bulk).trim()) return true;
  } catch {
    /* ignore */
  }
  return Boolean(getUserApiKey()?.trim());
}

/** 对话生图：是否跳过“理解意图”步骤，直接使用用户提示词调用生图模型 */
export function getDialogSkipUnderstand(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY_DIALOG_SKIP_UNDERSTAND) === '1';
  } catch {
    return false;
  }
}

export function setDialogSkipUnderstand(value: boolean): void {
  try {
    if (value) {
      localStorage.setItem(STORAGE_KEY_DIALOG_SKIP_UNDERSTAND, '1');
    } else {
      localStorage.removeItem(STORAGE_KEY_DIALOG_SKIP_UNDERSTAND);
    }
  } catch {
    // ignore
  }
}

/** 工作区：是否启用自动云同步（默认开启） */
export function getWorkspaceAutoSyncEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY_WORKSPACE_AUTO_SYNC) !== '0';
  } catch {
    return true;
  }
}

export function setWorkspaceAutoSyncEnabled(value: boolean): void {
  try {
    if (value) {
      localStorage.removeItem(STORAGE_KEY_WORKSPACE_AUTO_SYNC);
    } else {
      localStorage.setItem(STORAGE_KEY_WORKSPACE_AUTO_SYNC, '0');
    }
  } catch {
    // ignore
  }
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
const CAPABILITY_STORE_CATALOG_PATH = '/api/r2/capability-store/catalog';
/** 固定 R2 源：本地可走同源 /api/r2 代理；线上优先拼接 VITE_R2_API_BASE_URL / VITE_AUTH_API_BASE_URL */
export const DEFAULT_CAPABILITY_STORE_R2_CATALOG_URL = CAPABILITY_STORE_CATALOG_PATH;

function trimSlash(input: string): string {
  return String(input || '').trim().replace(/\/+$/, '');
}

function resolveCapabilityStoreCatalogUrl(): string {
  try {
    const env =
      typeof import.meta !== 'undefined'
        ? (import.meta as { env?: Record<string, string | undefined> }).env
        : undefined;
    const r2Base = trimSlash(env?.VITE_R2_API_BASE_URL || '');
    const authBase = trimSlash(env?.VITE_AUTH_API_BASE_URL || '');
    const base = r2Base || authBase;
    if (!base) return CAPABILITY_STORE_CATALOG_PATH;
    return `${base}${CAPABILITY_STORE_CATALOG_PATH}`;
  } catch {
    return CAPABILITY_STORE_CATALOG_PATH;
  }
}

export function getCapabilityStoreCatalogUrl(): string {
  return '';
}

export function setCapabilityStoreCatalogUrl(value: string | null): void {
  void value;
}

export function getCapabilityStoreR2CatalogUrl(): string {
  return resolveCapabilityStoreCatalogUrl();
}

export function setCapabilityStoreR2CatalogUrl(value: string | null): void {
  void value;
}

export function getCapabilityStoreCatalogSources(): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (v: string) => {
    const t = String(v || '').trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };
  push(getCapabilityStoreR2CatalogUrl());
  return out;
}
