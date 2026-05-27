/**
 * 用户设置的 API 密钥存 localStorage，键名与读写逻辑集中在此；底层经 `clientPersist` 安全访问。
 *
 * **AI 渠道唯一真相源**：`getEnabledChannels()` + `pickBinding()` + 各 channel 凭证。
 * legacy `getAiProvider()` / `enabledAiProviders` 仅云同步与试用模式兼容。
 * 禁止在组件里自行 `new GoogleGenAI`、直连 ToAPIs/VectorEngine，以免与设置里选的渠道不一致。
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
import {
  isConfigurableAiProvider,
  migrateLegacyAiProviderToEnabled,
  normalizeEnabledAiProviders,
  type ConfigurableAiProvider,
} from './aiProviderCatalog';
import {
  isChannelId,
  labelForChannel,
  normalizeEnabledChannels,
} from './modelRegistry/channelCatalog';
import { defaultEnabledChannelIds } from './modelRegistry/providerBindings';
import type { ChannelId } from './modelRegistry/types';
import { normalizeOpenAiBaseUrl } from './openaiAdapter';
import { normalizeToapisBaseUrl } from './toapisAdapter';

const STORAGE_KEY_GEMINI = 'ac_gemini_api_key';
const STORAGE_KEY_AI_PROVIDER = 'ac_ai_provider';
const STORAGE_KEY_ENABLED_AI_PROVIDERS = 'ac_ai_enabled_providers';
const STORAGE_KEY_ENABLED_CHANNELS = 'ac_enabled_channels';

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
const STORAGE_KEY_ANTIGRAVITY_API_KEY = 'ac_antigravity_api_key';
const STORAGE_KEY_ANTIGRAVITY_BASE_URL = 'ac_antigravity_base_url';
const STORAGE_KEY_VECTORENGINE_API_KEY = 'ac_vectorengine_api_key';
const STORAGE_KEY_VECTORENGINE_BASE_URL = 'ac_vectorengine_base_url';
const STORAGE_KEY_TRIPO_API_KEY = 'ac_tripo_api_key';
const STORAGE_KEY_DIALOG_SKIP_UNDERSTAND = 'ac_dialog_skip_understand';
const STORAGE_KEY_WORKSPACE_AUTO_SYNC = 'ac_workspace_auto_sync';
const STORAGE_KEY_DEBUG_CLIENT_LOG_PERSIST = 'ac_debug_client_log_persist';

export type AiProvider = 'trial' | 'gemini' | 'vertex' | 'toapis' | 'antigravity' | 'openai' | 'vectorengine';

export type { ConfigurableAiProvider };

/** 未选择或本地无记录时的默认供应商（legacy 单选字段；新 UI 以 `getEnabledAiProviders` 为准） */
export const DEFAULT_AI_PROVIDER: AiProvider = 'gemini';
const SESSION_KEY_TENCENT_SECRET_ID = 'ac_tencent_secret_id';
const SESSION_KEY_TENCENT_SECRET_KEY = 'ac_tencent_secret_key';

// ----- Gemini -----
export function getUserApiKey(): string | null {
  return readLocalNonEmptyTrimmed(STORAGE_KEY_GEMINI);
}

export function setUserApiKey(value: string | null): void {
  writeLocalNonEmptyTrimmedOrRemove(STORAGE_KEY_GEMINI, value);
}

function readAiProviderRaw(): string {
  return (readLocalString(STORAGE_KEY_AI_PROVIDER) ?? '').trim().toLowerCase();
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

function dispatchAiSettingsChanged(): void {
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('ac-ai-provider-changed'));
    }
  } catch {
    /* ignore */
  }
}

function syncLegacyPrimaryProviderFromEnabled(enabled: ConfigurableAiProvider[]): void {
  const primary = enabled[0] ?? DEFAULT_AI_PROVIDER;
  writeLocalString(STORAGE_KEY_AI_PROVIDER, primary);
}

/** @deprecated 设置 UI 已改为 channel；仅 legacy 云同步 / 顶栏兼容保留 */
export function getEnabledAiProviders(): ConfigurableAiProvider[] {
  const raw = readLocalString(STORAGE_KEY_ENABLED_AI_PROVIDERS);
  if (raw != null && raw !== '') {
    try {
      return normalizeEnabledAiProviders(JSON.parse(raw));
    } catch {
      /* fall through to legacy migration */
    }
  }
  return migrateLegacyAiProviderToEnabled(readLegacyAiProviderOnly());
}

function readLegacyAiProviderOnly(): AiProvider {
  const v = readAiProviderRaw();
  if (v === 'trial') return 'trial';
  if (v === 'vertex') return 'vertex';
  if (v === 'toapis') return 'toapis';
  if (v === 'antigravity') return 'antigravity';
  if (v === 'openai') return 'openai';
  if (v === 'vectorengine') return 'vectorengine';
  if (v === 'gemini') return 'gemini';
  return DEFAULT_AI_PROVIDER;
}

export function setEnabledAiProviders(providers: ConfigurableAiProvider[]): void {
  const next = normalizeEnabledAiProviders(providers);
  writeLocalString(STORAGE_KEY_ENABLED_AI_PROVIDERS, JSON.stringify(next));
  writeLocalString(STORAGE_KEY_ENABLED_CHANNELS, JSON.stringify(providersToChannels(next)));
  syncLegacyPrimaryProviderFromEnabled(next);
  dispatchAiSettingsChanged();
}

function providersToChannels(providers: ConfigurableAiProvider[]): ChannelId[] {
  const out: ChannelId[] = [];
  for (const p of providers) {
    if (p === 'vertex' && !out.includes('vertex-proxy')) out.push('vertex-proxy');
    if (p === 'gemini' && !out.includes('gemini-aistudio')) out.push('gemini-aistudio');
    if (p === 'toapis') {
      if (!out.includes('toapis-gemini')) out.push('toapis-gemini');
      if (!out.includes('toapis-openai')) out.push('toapis-openai');
    }
    if (p === 'openai' && !out.includes('openai-official')) out.push('openai-official');
    if (p === 'vectorengine' && !out.includes('vectorengine')) out.push('vectorengine');
  }
  return out;
}

function channelsToProviders(channels: ChannelId[]): ConfigurableAiProvider[] {
  const out: ConfigurableAiProvider[] = [];
  for (const ch of channels) {
    if (ch === 'vertex-proxy' && !out.includes('vertex')) out.push('vertex');
    if (ch === 'gemini-aistudio' && !out.includes('gemini')) out.push('gemini');
    if ((ch === 'toapis-gemini' || ch === 'toapis-openai') && !out.includes('toapis')) out.push('toapis');
    if (ch === 'openai-official' && !out.includes('openai')) out.push('openai');
    if (ch === 'vectorengine' && !out.includes('vectorengine')) out.push('vectorengine');
  }
  return out;
}

export function getEnabledChannels(): ChannelId[] {
  const raw = readLocalString(STORAGE_KEY_ENABLED_CHANNELS);
  if (raw != null && raw !== '') {
    try {
      const parsed = normalizeEnabledChannels(JSON.parse(raw));
      if (parsed.length > 0) return parsed;
    } catch {
      /* fall through */
    }
  }
  const fromProviders = providersToChannels(getEnabledAiProviders());
  if (fromProviders.length > 0) return fromProviders;
  return defaultEnabledChannelIds();
}

export function setEnabledChannels(channels: ChannelId[]): void {
  const next = normalizeEnabledChannels(channels);
  writeLocalString(STORAGE_KEY_ENABLED_CHANNELS, JSON.stringify(next));
  const providers = channelsToProviders(next);
  writeLocalString(STORAGE_KEY_ENABLED_AI_PROVIDERS, JSON.stringify(providers));
  syncLegacyPrimaryProviderFromEnabled(providers);
  dispatchAiSettingsChanged();
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

export function isAiProviderEnabled(provider: ConfigurableAiProvider): boolean {
  return getEnabledAiProviders().includes(provider);
}

export function setAiProviderEnabled(provider: ConfigurableAiProvider, enabled: boolean): void {
  const current = getEnabledAiProviders();
  const next = enabled
    ? current.includes(provider)
      ? current
      : [...current, provider]
    : current.filter((p) => p !== provider);
  setEnabledAiProviders(next);
}

/** 单个供应商是否具备调用条件（与是否启用无关，仅看凭证 / 代理） */
export function isAiProviderReady(provider: AiProvider): boolean {
  if (provider === 'trial') return bulkImageProxyConfigured();
  if (provider === 'vertex') return bulkImageVertexProxyConfigured();
  if (provider === 'toapis') return Boolean(getToapisApiKey()?.trim());
  if (provider === 'antigravity') return Boolean(getAntigravityApiKey()?.trim());
  if (provider === 'openai') return Boolean(getOpenaiApiKey()?.trim());
  if (provider === 'vectorengine') return Boolean(getVectorengineApiKey()?.trim());
  if (bulkImageProxyConfigured()) return true;
  return Boolean(getUserApiKey()?.trim());
}

/** @deprecated 请用 `getEnabledChannels()` + `pickBinding()`；legacy 顶栏/云同步仍读此字段 */
export function getAiProvider(): AiProvider {
  const enabled = getEnabledAiProviders();
  const ready = enabled.find((p) => isAiProviderReady(p));
  if (ready) return ready;
  if (enabled[0]) return enabled[0];
  const v = readLegacyAiProviderOnly();
  if (v === 'trial') return 'trial';
  if (v === 'vertex') return 'vertex';
  if (v === 'toapis') return 'toapis';
  if (v === 'antigravity') return 'antigravity';
  if (v === 'openai') return 'openai';
  if (v === 'vectorengine') return 'vectorengine';
  if (v === 'gemini') return 'gemini';
  return DEFAULT_AI_PROVIDER;
}

export function setAiProvider(value: AiProvider): void {
  if (isConfigurableAiProvider(value)) {
    setEnabledAiProviders([value]);
    return;
  }
  writeLocalString(STORAGE_KEY_AI_PROVIDER, value);
  writeLocalString(STORAGE_KEY_ENABLED_AI_PROVIDERS, JSON.stringify([]));
  writeLocalString(STORAGE_KEY_ENABLED_CHANNELS, JSON.stringify([]));
  dispatchAiSettingsChanged();
}

/** 另一浏览器标签页修改了下列键时，`storage` 事件会触发；用于设置页与顶栏等保持同步 */
export function isAiSettingsStorageKey(key: string | null): boolean {
  if (key == null) return true;
  return (
    key === STORAGE_KEY_AI_PROVIDER ||
    key === STORAGE_KEY_ENABLED_AI_PROVIDERS ||
    key === STORAGE_KEY_ENABLED_CHANNELS ||
    key === STORAGE_KEY_GEMINI ||
    key === STORAGE_KEY_TOAPIS_API_KEY ||
    key === STORAGE_KEY_TOAPIS_BASE_URL ||
    key === STORAGE_KEY_OPENAI_API_KEY ||
    key === STORAGE_KEY_OPENAI_BASE_URL ||
    key === STORAGE_KEY_ANTIGRAVITY_API_KEY ||
    key === STORAGE_KEY_ANTIGRAVITY_BASE_URL ||
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

/** 工作区顶栏等：当前启用的 channel 摘要 */
export function getAiProviderToolbarLabel(): string {
  const degraded = getBindingDegradedHint();
  const channels = getEnabledChannels();
  if (channels.length === 0) {
    return degraded ? `未启用通道 · ${degraded}` : '未启用通道';
  }
  const readyCount = channels.filter((ch) => isChannelReady(ch)).length;
  const primary = channels.find((ch) => isChannelReady(ch)) ?? channels[0];
  const base = labelForChannel(primary);
  const summary = channels.length === 1 ? base : `${base} 等 ${readyCount}/${channels.length}`;
  return degraded ? `${summary} · ${degraded}` : summary;
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
  if (getAiProvider() === 'openai') {
    const k = getOpenaiApiKey();
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
 * 是否至少有一个已启用供应商具备调用条件。
 */
export function isAiInvocationReady(): boolean {
  const enabledChannels = getEnabledChannels();
  if (enabledChannels.length > 0) {
    return enabledChannels.some((ch) => isChannelReady(ch));
  }
  const enabled = getEnabledAiProviders();
  if (enabled.length > 0) {
    return enabled.some((p) => isAiProviderReady(p));
  }
  return isAiProviderReady(getAiProvider());
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
