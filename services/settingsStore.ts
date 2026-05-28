/**
 * 用户设置的 API 密钥存 localStorage，键名与读写逻辑集中在此；底层经 `clientPersist` 安全访问。
 *
 * **AI 唯一真相源**：`getEnabledChannels()` + `pickBinding()` + 各 channel 凭证。
 * 禁止在组件里自行 `new GoogleGenAI`、直连 ToAPIs/VectorEngine，以免与设置里选的渠道不一致。
 * 登录后云端 `user-config.json` 的 `enabledChannels` 会合并进同一套 localStorage 键。
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
import {
  isChannelId,
  normalizeEnabledChannels,
  TOAPIS_PATH_CHANNELS,
} from './modelRegistry/channelCatalog';
import {
  AI_CONNECTION_CATALOG,
  connectionStatus,
  statusLabel,
  type AiConnectionCatalogRow,
} from './modelRegistry/connectionCatalog';
import { defaultEnabledChannelIds } from './modelRegistry/providerBindings';
import type { ChannelId } from './modelRegistry/types';
import { normalizeOpenAiBaseUrl } from './openaiAdapter';

const STORAGE_KEY_GEMINI = 'ac_gemini_api_key';
const STORAGE_KEY_ENABLED_CHANNELS = 'ac_enabled_channels';
/** 已废弃，首次读写 channel 时清除 */
const STORAGE_KEY_AI_PROVIDER_LEGACY = 'ac_ai_provider';
const STORAGE_KEY_ENABLED_AI_PROVIDERS_LEGACY = 'ac_ai_enabled_providers';

let bindingDegradedHint: string | null = null;

/** merge 层全部生图模型不可用时设置；顶栏展示降级提示 */
export function setBindingDegradedHint(hint: string | null): void {
  bindingDegradedHint = hint?.trim() || null;
}

export function getBindingDegradedHint(): string | null {
  return bindingDegradedHint;
}
const STORAGE_KEY_TOAPIS_API_KEY = 'ac_toapis_api_key';
const STORAGE_KEY_TOAPIS_BASE_URL = 'ac_toapis_base_url';
const STORAGE_KEY_OPENAI_API_KEY = 'ac_openai_api_key';
const STORAGE_KEY_OPENAI_BASE_URL = 'ac_openai_base_url';
const STORAGE_KEY_VECTORENGINE_API_KEY = 'ac_vectorengine_api_key';
const STORAGE_KEY_VECTORENGINE_BASE_URL = 'ac_vectorengine_base_url';
const STORAGE_KEY_TRIPO_API_KEY = 'ac_tripo_api_key';
const STORAGE_KEY_DIALOG_SKIP_UNDERSTAND = 'ac_dialog_skip_understand';
const STORAGE_KEY_WORKSPACE_AUTO_SYNC = 'ac_workspace_auto_sync';
const STORAGE_KEY_DEBUG_CLIENT_LOG_PERSIST = 'ac_debug_client_log_persist';

const SESSION_KEY_TENCENT_SECRET_ID = 'ac_tencent_secret_id';
const SESSION_KEY_TENCENT_SECRET_KEY = 'ac_tencent_secret_key';

// ----- Gemini -----
export function getUserApiKey(): string | null {
  return readLocalNonEmptyTrimmed(STORAGE_KEY_GEMINI);
}

export function setUserApiKey(value: string | null): void {
  writeLocalNonEmptyTrimmedOrRemove(STORAGE_KEY_GEMINI, value);
}

let legacyAiStoragePurged = false;

function purgeLegacyAiProviderStorageOnce(): void {
  if (legacyAiStoragePurged) return;
  legacyAiStoragePurged = true;
  removeLocalKey(STORAGE_KEY_AI_PROVIDER_LEGACY);
  removeLocalKey(STORAGE_KEY_ENABLED_AI_PROVIDERS_LEGACY);
}

function bulkImageProxyConfigured(): boolean {
  try {
    const env = typeof import.meta !== 'undefined' ? (import.meta as { env?: Record<string, string | undefined> }).env : undefined;
    const bulk = env?.VITE_BULK_IMAGE_API;
    return Boolean(bulk && String(bulk).trim());
  } catch {
    return false;
  }
}

function bulkImageVertexProxyConfigured(): boolean {
  try {
    const env = typeof import.meta !== 'undefined' ? (import.meta as { env?: Record<string, string | undefined> }).env : undefined;
    const bulk = env?.VITE_BULK_IMAGE_API;
    const bulkVertex = env?.VITE_BULK_IMAGE_API_VERTEX;
    return Boolean((bulk && String(bulk).trim()) || (bulkVertex && String(bulkVertex).trim()));
  } catch {
    return false;
  }
}

export function isVertexSiteProxyConfigured(): boolean {
  return bulkImageVertexProxyConfigured();
}

function dispatchAiSettingsChanged(): void {
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('ac-ai-provider-changed'));
    }
  } catch {
    /* ignore */
  }
}

export function getEnabledChannels(): ChannelId[] {
  purgeLegacyAiProviderStorageOnce();
  const raw = readLocalString(STORAGE_KEY_ENABLED_CHANNELS);
  if (raw != null && raw !== '') {
    try {
      const parsed = normalizeEnabledChannels(JSON.parse(raw));
      if (parsed.length > 0) return parsed;
    } catch {
      /* fall through */
    }
  }
  return defaultEnabledChannelIds();
}

export function setEnabledChannels(channels: ChannelId[]): void {
  purgeLegacyAiProviderStorageOnce();
  const next = normalizeEnabledChannels(channels);
  writeLocalString(STORAGE_KEY_ENABLED_CHANNELS, JSON.stringify(next));
  dispatchAiSettingsChanged();
}

/** 云配置拉取：空或非法时回退默认 channel */
export function setEnabledChannelsFromCloud(raw: unknown): void {
  const parsed = normalizeEnabledChannels(raw);
  setEnabledChannels(parsed.length > 0 ? parsed : defaultEnabledChannelIds());
}

export function isChannelEnabled(channel: ChannelId): boolean {
  return getEnabledChannels().includes(channel);
}

/** 单个 channel 是否具备调用条件（与是否启用无关） */
export function isChannelReady(channel: ChannelId): boolean {
  if (channel === 'vertex-proxy') return bulkImageVertexProxyConfigured();
  if (channel === 'gemini-aistudio') return Boolean(getUserApiKey()?.trim()) || bulkImageProxyConfigured();
  if (channel === 'toapis-gemini' || channel === 'toapis-openai') return Boolean(getToapisApiKey()?.trim());
  if (channel === 'vectorengine') return Boolean(getVectorengineApiKey()?.trim());
  if (channel === 'openai-official') return Boolean(getOpenaiApiKey()?.trim());
  return false;
}

export function setChannelEnabled(channel: ChannelId, enabled: boolean): void {
  if (!isChannelId(channel)) return;
  const current = getEnabledChannels();
  const next = enabled
    ? current.includes(channel)
      ? current
      : [...current, channel]
    : current.filter((c) => c !== channel);
  setEnabledChannels(next);
}

export function isToapisGatewayEnabled(): boolean {
  const enabled = getEnabledChannels();
  return TOAPIS_PATH_CHANNELS.some((ch) => enabled.includes(ch));
}

/** 启用/禁用 ToAPIs 网关（同时开关 gemini/openai 两条内部 channel） */
export function setToapisGatewayEnabled(enabled: boolean): void {
  for (const ch of TOAPIS_PATH_CHANNELS) setChannelEnabled(ch, enabled);
}

/** 另一浏览器标签页修改了下列键时，`storage` 事件会触发；用于设置页与顶栏等保持同步 */
export function isAiSettingsStorageKey(key: string | null): boolean {
  if (key == null) return true;
  return (
    key === STORAGE_KEY_ENABLED_CHANNELS ||
    key === STORAGE_KEY_GEMINI ||
    key === STORAGE_KEY_TOAPIS_API_KEY ||
    key === STORAGE_KEY_TOAPIS_BASE_URL ||
    key === STORAGE_KEY_OPENAI_API_KEY ||
    key === STORAGE_KEY_OPENAI_BASE_URL ||
    key === STORAGE_KEY_VECTORENGINE_API_KEY ||
    key === STORAGE_KEY_VECTORENGINE_BASE_URL ||
    key === STORAGE_KEY_TRIPO_API_KEY
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

export type AiConnectionSummary = {
  total: number;
  ready: number;
  enabled: number;
  anyReady: boolean;
  primaryLabel: string;
};

function summarizeConnections(connections: readonly AiConnectionCatalogRow[]): AiConnectionSummary {
  const enabled = getEnabledChannels();
  let ready = 0;
  let enabledCount = 0;
  const readyTitles: string[] = [];
  for (const row of connections) {
    const st = connectionStatus(row, enabled, isChannelReady, isVertexSiteProxyConfigured);
    const active = row.channels.some((ch) => enabled.includes(ch));
    if (active) enabledCount += 1;
    if (st === 'ready') {
      ready += 1;
      readyTitles.push(row.title.split(' · ')[0]!);
    }
  }
  const total = connections.length;
  let primaryLabel = '未配置输出口';
  if (ready > 0) {
    const names = readyTitles.slice(0, 2).join('、');
    primaryLabel = readyTitles.length > 2 ? `已接入 · ${names} 等` : `已接入 · ${names}`;
  } else if (enabledCount > 0) {
    primaryLabel = '输出口待配置';
  }
  return { total, ready, enabled: enabledCount, anyReady: ready > 0, primaryLabel };
}

/** 设置页总览：接入方就绪情况 */
export function getAiConnectionSummary(): AiConnectionSummary {
  return summarizeConnections(AI_CONNECTION_CATALOG);
}

/** 工作区顶栏等：接入方摘要（保留旧导出名） */
export function getAiProviderToolbarLabel(): string {
  const degraded = getBindingDegradedHint();
  const { primaryLabel, ready, total, enabled } = summarizeConnections(AI_CONNECTION_CATALOG);
  if (enabled === 0) {
    return degraded ? `未配置输出口 · ${degraded}` : '未配置输出口';
  }
  if (ready === 0) {
    return degraded ? `输出口待配置 · ${degraded}` : '输出口待配置';
  }
  if (ready < total) {
    const base = `${primaryLabel}（${ready}/${total}）`;
    return degraded ? `${base} · ${degraded}` : base;
  }
  return degraded ? `${primaryLabel} · ${degraded}` : primaryLabel;
}

export { statusLabel as aiConnectionStatusLabel };

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

export function getOpenaiApiKey(): string | null {
  return readLocalNonEmptyTrimmed(STORAGE_KEY_OPENAI_API_KEY);
}

export function setOpenaiApiKey(value: string | null): void {
  writeLocalNonEmptyTrimmedOrRemove(STORAGE_KEY_OPENAI_API_KEY, value);
}

/** OpenAI API 根路径，须含 /v1，默认 https://api.openai.com/v1 */
export function getOpenaiBaseUrl(): string {
  const t = readLocalNonEmptyTrimmed(STORAGE_KEY_OPENAI_BASE_URL) ?? '';
  return t.trim() ? normalizeOpenAiBaseUrl(t) : normalizeOpenAiBaseUrl('');
}

export function setOpenaiBaseUrl(value: string | null): void {
  writeLocalNonEmptyTrimmedOrRemove(STORAGE_KEY_OPENAI_BASE_URL, value);
}

export function getVectorengineApiKey(): string | null {
  return readLocalNonEmptyTrimmed(STORAGE_KEY_VECTORENGINE_API_KEY);
}

export function setVectorengineApiKey(value: string | null): void {
  writeLocalNonEmptyTrimmedOrRemove(STORAGE_KEY_VECTORENGINE_API_KEY, value);
}

export function getTripoApiKey(): string | null {
  return readLocalNonEmptyTrimmed(STORAGE_KEY_TRIPO_API_KEY);
}

export function setTripoApiKey(value: string | null): void {
  writeLocalNonEmptyTrimmedOrRemove(STORAGE_KEY_TRIPO_API_KEY, value);
}

/** 向量引擎根地址（不含 /v1beta 路径），如 https://api.vectorengine.ai */
export function getVectorengineBaseUrl(): string {
  const t = readLocalNonEmptyTrimmed(STORAGE_KEY_VECTORENGINE_BASE_URL) ?? '';
  return t || 'https://api.vectorengine.ai';
}

export function setVectorengineBaseUrl(value: string | null): void {
  writeLocalNonEmptyTrimmedOrRemove(STORAGE_KEY_VECTORENGINE_BASE_URL, value);
}

/** @deprecated 请用 channel 凭证；保留供极少数 legacy 调用 */
export function getApiKey(): string | undefined {
  for (const ch of getEnabledChannels()) {
    if (ch === 'gemini-aistudio') {
      const k = getUserApiKey();
      if (k?.trim()) return k;
    }
    if (ch === 'toapis-gemini' || ch === 'toapis-openai') {
      const k = getToapisApiKey();
      if (k?.trim()) return k;
    }
    if (ch === 'openai-official') {
      const k = getOpenaiApiKey();
      if (k?.trim()) return k;
    }
    if (ch === 'vectorengine') {
      const k = getVectorengineApiKey();
      if (k?.trim()) return k;
    }
  }
  const user = getUserApiKey();
  return user?.trim() ? user : undefined;
}

/**
 * 是否至少有一个已启用 channel 具备调用条件。
 */
export function isAiInvocationReady(): boolean {
  const enabledChannels = getEnabledChannels();
  if (enabledChannels.length > 0) {
    return enabledChannels.some((ch) => isChannelReady(ch));
  }
  return bulkImageProxyConfigured() || Boolean(getUserApiKey()?.trim());
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

/** 调试模式：是否允许将前端运行日志脱敏后落盘（默认关闭） */
export function getDebugClientLogPersistEnabled(): boolean {
  return readLocalFlag(STORAGE_KEY_DEBUG_CLIENT_LOG_PERSIST);
}

export function setDebugClientLogPersistEnabled(value: boolean): void {
  writeLocalFlag(STORAGE_KEY_DEBUG_CLIENT_LOG_PERSIST, value);
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
