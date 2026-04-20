/**
 * 用户设置的 API 密钥存 localStorage，键名与读写逻辑集中在此；底层经 `clientPersist` 安全访问。
 *
 * **AI 渠道（供应商）唯一真相源**：`getAiProvider()` + 各供应商对应的 Key/BaseURL（见下方 getter）。
 * 全站所有大模型调用必须走 `geminiService.getAI()`（内部**每次**调用都会读当前 `getAiProvider()`），
 * 禁止在业务组件里自行 `new GoogleGenAI`、直连 ToAPIs/VectorEngine，以免与设置里选的渠道不一致。
 * 登录后云端 `user-config.json` 会合并进同一套 localStorage 键，与设置页、工作流密钥弹窗共用。
 */

import {
  readLocalFlag,
  readLocalNonEmptyTrimmed,
  readLocalString,
  readSessionNonEmptyTrimmed,
  removeLocalKey,
  writeLocalFlag,
  writeLocalNonEmptyTrimmedOrRemove,
  writeLocalString,
  writeSessionNonEmptyTrimmedOrRemove,
} from './clientPersist';
import { normalizeToapisBaseUrl } from './toapisAdapter';

const STORAGE_KEY_GEMINI = 'ac_gemini_api_key';
const STORAGE_KEY_AI_PROVIDER = 'ac_ai_provider';
const STORAGE_KEY_TOAPIS_API_KEY = 'ac_toapis_api_key';
const STORAGE_KEY_TOAPIS_BASE_URL = 'ac_toapis_base_url';
const STORAGE_KEY_ANTIGRAVITY_API_KEY = 'ac_antigravity_api_key';
const STORAGE_KEY_ANTIGRAVITY_BASE_URL = 'ac_antigravity_base_url';
const STORAGE_KEY_VECTORENGINE_API_KEY = 'ac_vectorengine_api_key';
const STORAGE_KEY_VECTORENGINE_BASE_URL = 'ac_vectorengine_base_url';
const STORAGE_KEY_DIALOG_SKIP_UNDERSTAND = 'ac_dialog_skip_understand';
const STORAGE_KEY_WORKSPACE_AUTO_SYNC = 'ac_workspace_auto_sync';

export type AiProvider = 'trial' | 'gemini' | 'vertex' | 'toapis' | 'antigravity' | 'vectorengine';

/** 未选择或本地无记录时的默认供应商（新用户 / 清空存储后） */
export const DEFAULT_AI_PROVIDER: AiProvider = 'trial';
const SESSION_KEY_TENCENT_SECRET_ID = 'ac_tencent_secret_id';
const SESSION_KEY_TENCENT_SECRET_KEY = 'ac_tencent_secret_key';

// ----- Gemini -----
export function getUserApiKey(): string | null {
  return readLocalNonEmptyTrimmed(STORAGE_KEY_GEMINI);
}

export function setUserApiKey(value: string | null): void {
  writeLocalNonEmptyTrimmedOrRemove(STORAGE_KEY_GEMINI, value);
}

export function getAiProvider(): AiProvider {
  const v = (readLocalString(STORAGE_KEY_AI_PROVIDER) ?? '').trim().toLowerCase();
  if (v === 'trial') return 'trial';
  if (v === 'vertex') return 'vertex';
  if (v === 'toapis') return 'toapis';
  if (v === 'antigravity') return 'antigravity';
  if (v === 'vectorengine') return 'vectorengine';
  if (v === 'gemini') return 'gemini';
  return DEFAULT_AI_PROVIDER;
}

export function setAiProvider(value: AiProvider): void {
  writeLocalString(STORAGE_KEY_AI_PROVIDER, value);
}

/** 另一浏览器标签页修改了下列键时，`storage` 事件会触发；用于设置页与顶栏等保持同步 */
export function isAiSettingsStorageKey(key: string | null): boolean {
  if (key == null) return true;
  return (
    key === STORAGE_KEY_AI_PROVIDER ||
    key === STORAGE_KEY_GEMINI ||
    key === STORAGE_KEY_TOAPIS_API_KEY ||
    key === STORAGE_KEY_TOAPIS_BASE_URL ||
    key === STORAGE_KEY_ANTIGRAVITY_API_KEY ||
    key === STORAGE_KEY_ANTIGRAVITY_BASE_URL ||
    key === STORAGE_KEY_VECTORENGINE_API_KEY ||
    key === STORAGE_KEY_VECTORENGINE_BASE_URL
  );
}

export function subscribeAiSettingsCrossTab(onChange: () => void): () => void {
  const handler = (e: StorageEvent) => {
    if (isAiSettingsStorageKey(e.key)) onChange();
  };
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}

/** 工作区顶栏等：当前选用的 AI 供应商短名称 */
export function getAiProviderToolbarLabel(): string {
  switch (getAiProvider()) {
    case 'trial':
      return '试用（代理）';
    case 'vertex':
      return 'Vertex AI';
    case 'toapis':
      return 'ToAPIs';
    case 'antigravity':
      return 'Antigravity';
    case 'vectorengine':
      return 'VectorEngine';
    default:
      return 'Google Gemini';
  }
}

export function getToapisApiKey(): string | null {
  return readLocalNonEmptyTrimmed(STORAGE_KEY_TOAPIS_API_KEY);
}

export function setToapisApiKey(value: string | null): void {
  writeLocalNonEmptyTrimmedOrRemove(STORAGE_KEY_TOAPIS_API_KEY, value);
}

/** ToAPIs 网关根路径，须含 /v1，如 https://toapis.com/v1 */
export function getToapisBaseUrl(): string {
  const t = readLocalNonEmptyTrimmed(STORAGE_KEY_TOAPIS_BASE_URL) ?? '';
  return t || 'https://toapis.com/v1';
}

export function setToapisBaseUrl(value: string | null): void {
  writeLocalNonEmptyTrimmedOrRemove(STORAGE_KEY_TOAPIS_BASE_URL, value);
}

export function getAntigravityApiKey(): string | null {
  return readLocalNonEmptyTrimmed(STORAGE_KEY_ANTIGRAVITY_API_KEY);
}

export function setAntigravityApiKey(value: string | null): void {
  writeLocalNonEmptyTrimmedOrRemove(STORAGE_KEY_ANTIGRAVITY_API_KEY, value);
}

/** Antigravity-Manager 反代 OpenAI 兼容根路径，默认本机 8045，如 http://127.0.0.1:8045/v1 */
export function getAntigravityBaseUrl(): string {
  const t = readLocalNonEmptyTrimmed(STORAGE_KEY_ANTIGRAVITY_BASE_URL) ?? '';
  if (!t.trim()) return 'http://127.0.0.1:8045/v1';
  return normalizeToapisBaseUrl(t);
}

export function setAntigravityBaseUrl(value: string | null): void {
  writeLocalNonEmptyTrimmedOrRemove(STORAGE_KEY_ANTIGRAVITY_BASE_URL, value);
}

export function getVectorengineApiKey(): string | null {
  return readLocalNonEmptyTrimmed(STORAGE_KEY_VECTORENGINE_API_KEY);
}

export function setVectorengineApiKey(value: string | null): void {
  writeLocalNonEmptyTrimmedOrRemove(STORAGE_KEY_VECTORENGINE_API_KEY, value);
}

/** 向量引擎根地址（不含 /v1beta 路径），如 https://api.vectorengine.ai */
export function getVectorengineBaseUrl(): string {
  const t = readLocalNonEmptyTrimmed(STORAGE_KEY_VECTORENGINE_BASE_URL) ?? '';
  return t || 'https://api.vectorengine.ai';
}

export function setVectorengineBaseUrl(value: string | null): void {
  writeLocalNonEmptyTrimmedOrRemove(STORAGE_KEY_VECTORENGINE_BASE_URL, value);
}

/** 当前选用供应商下的 API Key（Gemini 官方、ToAPIs 或 VectorEngine） */
export function getApiKey(): string | undefined {
  if (getAiProvider() === 'trial') {
    return undefined;
  }
  if (getAiProvider() === 'vertex') {
    return undefined;
  }
  if (getAiProvider() === 'toapis') {
    const k = getToapisApiKey();
    return k ?? undefined;
  }
  if (getAiProvider() === 'antigravity') {
    const k = getAntigravityApiKey();
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
 * - ToAPIs / Antigravity / VectorEngine：本机已填 Key
 * - Vertex：构建时配置了 VITE_BULK_IMAGE_API（与官方 Gemini 走后端代理相同；GCP 凭据仅在代理服务器）
 * - Gemini：本机 Key，或构建时配置了 VITE_BULK_IMAGE_API（走后端代理；与 geminiService.getAI 优先级一致）
 */
export function isAiInvocationReady(): boolean {
  const p = getAiProvider();
  if (p === 'trial') {
    try {
      const env = typeof import.meta !== 'undefined' ? (import.meta as { env?: Record<string, string | undefined> }).env : undefined;
      const bulk = env?.VITE_BULK_IMAGE_API;
      return Boolean(bulk && String(bulk).trim());
    } catch {
      return false;
    }
  }
  if (p === 'vertex') {
    try {
      const env = typeof import.meta !== 'undefined' ? (import.meta as { env?: Record<string, string | undefined> }).env : undefined;
      const bulk = env?.VITE_BULK_IMAGE_API;
      if (bulk && String(bulk).trim()) return true;
    } catch {
      /* ignore */
    }
    return false;
  }
  if (p === 'toapis') return Boolean(getToapisApiKey()?.trim());
  if (p === 'antigravity') return Boolean(getAntigravityApiKey()?.trim());
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
  return readLocalFlag(STORAGE_KEY_DIALOG_SKIP_UNDERSTAND);
}

export function setDialogSkipUnderstand(value: boolean): void {
  writeLocalFlag(STORAGE_KEY_DIALOG_SKIP_UNDERSTAND, value);
}

/** 工作区：是否启用自动云同步（默认开启） */
export function getWorkspaceAutoSyncEnabled(): boolean {
  return readLocalString(STORAGE_KEY_WORKSPACE_AUTO_SYNC) !== '0';
}

export function setWorkspaceAutoSyncEnabled(value: boolean): void {
  if (value) {
    removeLocalKey(STORAGE_KEY_WORKSPACE_AUTO_SYNC);
  } else {
    writeLocalString(STORAGE_KEY_WORKSPACE_AUTO_SYNC, '0');
  }
}

// ----- 混元（腾讯云） -----
export function getTencentSecretId(): string | null {
  return readSessionNonEmptyTrimmed(SESSION_KEY_TENCENT_SECRET_ID);
}

export function setTencentSecretId(value: string | null): void {
  writeSessionNonEmptyTrimmedOrRemove(SESSION_KEY_TENCENT_SECRET_ID, value);
}

export function getTencentSecretKey(): string | null {
  return readSessionNonEmptyTrimmed(SESSION_KEY_TENCENT_SECRET_KEY);
}

export function setTencentSecretKey(value: string | null): void {
  writeSessionNonEmptyTrimmedOrRemove(SESSION_KEY_TENCENT_SECRET_KEY, value);
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
