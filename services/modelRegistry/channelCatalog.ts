import type { ConfigurableAiProvider } from "../aiProviderCatalog";
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
    label: "Vertex AI（站点代理 · 推荐）",
    family: "gemini",
    needsApiKey: false,
    hint: "由 gemini-proxy 转发；需 VITE_BULK_IMAGE_API_VERTEX 或 VITE_BULK_IMAGE_API。",
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

/** 云同步 legacy `aiProvider` 字段：由当前启用 channel 推导 */
export function channelToLegacyProvider(channel: ChannelId): ConfigurableAiProvider {
  switch (channel) {
    case "vertex-proxy":
      return "vertex";
    case "gemini-aistudio":
      return "gemini";
    case "toapis-gemini":
    case "toapis-openai":
      return "toapis";
    case "vectorengine":
      return "vectorengine";
    case "openai-official":
      return "openai";
  }
}
