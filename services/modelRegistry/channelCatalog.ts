import type { ChannelId, ModelFamily } from "./types";

export type ChannelCatalogRow = {
  channel: ChannelId;
  label: string;
  family: ModelFamily;
  needsApiKey: boolean;
  needsBaseUrl?: boolean;
  baseUrlPlaceholder?: string;
  keyPlaceholder?: string;
  hint?: string;
  /** UI 灰显（如 AI Studio 当前不可用） */
  deprecated?: boolean;
};

export const CHANNEL_CATALOG: readonly ChannelCatalogRow[] = [
  {
    channel: "vertex-proxy",
    label: "Vertex AI（站点代理）",
    family: "gemini",
    needsApiKey: false,
    hint: "由 AI Worker Proxy 转发；需配置 VITE_AI_WORKER_PROXY_API_VERTEX 或 VITE_AI_WORKER_PROXY_API。",
  },
  {
    channel: "gemini-aistudio",
    label: "Google AI Studio Key",
    family: "gemini",
    needsApiKey: true,
    keyPlaceholder: "Gemini API Key",
    deprecated: true,
    hint: "官方直连，当前不稳定；建议优先 Vertex。",
  },
  {
    channel: "toapis-gemini",
    label: "ToAPIs · Gemini 路径",
    family: "gemini",
    needsApiKey: true,
    needsBaseUrl: true,
    baseUrlPlaceholder: "https://toapis.com/v1",
    keyPlaceholder: "ToAPIs API Key",
    hint: "中转站 Gemini 兼容路径（与下方 OpenAI 路径共用 Key）。",
  },
  {
    channel: "vectorengine",
    label: "VectorEngine · Gemini REST",
    family: "gemini",
    needsApiKey: true,
    needsBaseUrl: true,
    baseUrlPlaceholder: "https://api.vectorengine.ai",
    keyPlaceholder: "VectorEngine API Key",
  },
  {
    channel: "openai-official",
    label: "OpenAI 官方",
    family: "openai",
    needsApiKey: true,
    needsBaseUrl: true,
    baseUrlPlaceholder: "https://api.openai.com/v1",
    keyPlaceholder: "OpenAI API Key（sk-…）",
  },
  {
    channel: "toapis-openai",
    label: "ToAPIs · OpenAI 路径",
    family: "openai",
    needsApiKey: true,
    needsBaseUrl: true,
    baseUrlPlaceholder: "https://toapis.com/v1",
    keyPlaceholder: "ToAPIs API Key（与 Gemini 路径共用）",
    hint: "中转站 OpenAI 兼容路径。",
  },
  {
    channel: "302ai-openai",
    label: "302.AI / OpenAI",
    family: "openai",
    needsApiKey: true,
    needsBaseUrl: true,
    baseUrlPlaceholder: "https://api.302.ai/v1",
    keyPlaceholder: "302.AI API Key",
    hint: "302.AI OpenAI-compatible gateway for text and image routes.",
  },
  {
    channel: "aihubmix-openai",
    label: "AIHubMix / OpenAI",
    family: "openai",
    needsApiKey: true,
    needsBaseUrl: true,
    baseUrlPlaceholder: "https://aihubmix.com/v1",
    keyPlaceholder: "AIHubMix API Key",
    hint: "AIHubMix OpenAI-compatible gateway for text and image routes.",
  },
  {
    channel: "tinysnow-openai",
    label: "TinySnow / OpenAI",
    family: "openai",
    needsApiKey: true,
    needsBaseUrl: true,
    baseUrlPlaceholder: "https://tinysnow.one/v1",
    keyPlaceholder: "TinySnow API Key",
    hint: "TinySnow OpenAI-compatible endpoint; image generation uses gpt-image-2 with b64_json.",
  },
  {
    channel: "volcengine-ark",
    label: "火山方舟（OpenAI 兼容）",
    family: "volcengine-ark",
    needsApiKey: true,
    needsBaseUrl: true,
    baseUrlPlaceholder: "https://ark.cn-beijing.volces.com/api/v3",
    keyPlaceholder: "火山方舟 API Key",
    hint: "火山方舟大模型推理服务；按 OpenAI 兼容协议请求。",
  },
  {
    channel: "volcengine-jimeng",
    label: "火山引擎 · 即梦（站点代理）",
    family: "volcengine-jimeng",
    needsApiKey: false,
    hint: "由 auth-api /api/jimeng 转发；需 VOLCENGINE_* 与 JIMENG_API_ENABLED。",
  },
] as const;

export const CHANNEL_IDS: readonly ChannelId[] = CHANNEL_CATALOG.map((r) => r.channel);

export function isChannelId(value: string): value is ChannelId {
  return (CHANNEL_IDS as readonly string[]).includes(value);
}

export function normalizeEnabledChannels(raw: unknown): ChannelId[] {
  if (!Array.isArray(raw)) return [];
  const out: ChannelId[] = [];
  for (const item of raw) {
    const id = String(item ?? "").trim();
    if (!isChannelId(id)) continue;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

export function labelForChannel(channel: ChannelId): string {
  return CHANNEL_CATALOG.find((r) => r.channel === channel)?.label ?? channel;
}

/** 型号接线面板：供应商节点 + 形态（设置主卡片不展示协议路径细节） */
const WIRING_SUPPLIER_OUTLET_LABELS: Partial<Record<ChannelId, string>> = {
  "vertex-proxy": "Vertex · 站点代理",
  "gemini-aistudio": "Google AI Studio",
  "toapis-gemini": "ToAPIs · Gemini 形态",
  "toapis-openai": "ToAPIs · OpenAI 形态",
  "302ai-openai": "302.AI / OpenAI",
  "aihubmix-openai": "AIHubMix / OpenAI",
  "tinysnow-openai": "TinySnow / OpenAI",
  vectorengine: "VectorEngine",
  "openai-official": "OpenAI 官方",
  "volcengine-jimeng": "火山引擎 · 即梦",
};

export function outletDisplayLabelForWiring(channel: ChannelId): string {
  return WIRING_SUPPLIER_OUTLET_LABELS[channel] ?? labelForChannel(channel);
}

/** ToAPIs 双路径 channel（共用 Key，设置 UI 合并为一行） */
export const TOAPIS_PATH_CHANNELS = ["toapis-gemini", "toapis-openai"] as const satisfies readonly ChannelId[];

export function isToapisPathChannel(channel: ChannelId): boolean {
  return (TOAPIS_PATH_CHANNELS as readonly string[]).includes(channel);
}

export function channelsForFamily(family: ModelFamily): ChannelCatalogRow[] {
  return CHANNEL_CATALOG.filter((r) => r.family === family);
}

/** 设置面板：按族展示，ToAPIs 路径单独成组 */
export function channelsForFamilyPanel(family: ModelFamily): ChannelCatalogRow[] {
  return CHANNEL_CATALOG.filter((r) => r.family === family && !isToapisPathChannel(r.channel));
}
