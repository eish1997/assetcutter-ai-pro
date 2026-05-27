import type { AiProvider } from './settingsStore';

/**
 * @deprecated 过渡层：新代码请用 `services/modelRegistry/channelCatalog` + `pickBinding`。
 * `enabledAiProviders` 由 `enabledChannels` 双向同步，仅供云配置 legacy 字段。
 */
/** 设置页可配置的 AI 供应商（不含试用 / Antigravity） */
export type ConfigurableAiProvider = 'vertex' | 'gemini' | 'toapis' | 'openai' | 'vectorengine';

export const CONFIGURABLE_AI_PROVIDERS: readonly ConfigurableAiProvider[] = [
  'vertex',
  'gemini',
  'toapis',
  'openai',
  'vectorengine',
] as const;

export type AiProviderCatalogRow = {
  id: ConfigurableAiProvider;
  label: string;
  hint?: string;
  /** 浏览器侧是否需要填写 API Key */
  needsApiKey: boolean;
  /** 是否展示 Base URL 输入 */
  needsBaseUrl?: boolean;
  baseUrlPlaceholder?: string;
  keyPlaceholder?: string;
};

export const AI_PROVIDER_CATALOG: readonly AiProviderCatalogRow[] = [
  {
    id: 'vertex',
    label: 'Vertex AI（GCP · 经站点代理）',
    hint: '由 gemini-proxy 转发，浏览器无需填写 GCP 密钥；需站点配置 VITE_BULK_IMAGE_API_VERTEX 或 VITE_BULK_IMAGE_API。',
    needsApiKey: false,
  },
  {
    id: 'gemini',
    label: 'Google Gemini（官方 API）',
    needsApiKey: true,
    keyPlaceholder: 'Google AI Studio / Gemini API Key',
  },
  {
    id: 'toapis',
    label: 'ToAPIs 网关（OpenAI 兼容 + 异步生图）',
    needsApiKey: true,
    needsBaseUrl: true,
    baseUrlPlaceholder: 'https://toapis.com/v1',
    keyPlaceholder: 'ToAPIs API Key',
  },
  {
    id: 'openai',
    label: 'OpenAI（官方 Chat + Images API）',
    needsApiKey: true,
    needsBaseUrl: true,
    baseUrlPlaceholder: 'https://api.openai.com/v1',
    keyPlaceholder: 'OpenAI API Key（sk-…）',
  },
  {
    id: 'vectorengine',
    label: '向量引擎 VectorEngine（Gemini 原生 REST）',
    needsApiKey: true,
    needsBaseUrl: true,
    baseUrlPlaceholder: 'https://api.vectorengine.ai',
    keyPlaceholder: 'VectorEngine API Key',
  },
] as const;

export function isConfigurableAiProvider(value: string): value is ConfigurableAiProvider {
  return (CONFIGURABLE_AI_PROVIDERS as readonly string[]).includes(value);
}

export function normalizeEnabledAiProviders(raw: unknown): ConfigurableAiProvider[] {
  if (!Array.isArray(raw)) return [];
  const out: ConfigurableAiProvider[] = [];
  for (const item of raw) {
    const id = String(item ?? '').trim().toLowerCase();
    if (!isConfigurableAiProvider(id)) continue;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** 从旧版单一供应商迁移；trial / antigravity 不再进入启用列表 */
export function migrateLegacyAiProviderToEnabled(legacy: AiProvider): ConfigurableAiProvider[] {
  if (legacy === 'trial' || legacy === 'antigravity') return [];
  if (isConfigurableAiProvider(legacy)) return [legacy];
  return [];
}

export function labelForConfigurableAiProvider(id: ConfigurableAiProvider): string {
  return AI_PROVIDER_CATALOG.find((r) => r.id === id)?.label ?? id;
}
