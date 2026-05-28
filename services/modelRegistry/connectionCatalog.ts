import { TOAPIS_PATH_CHANNELS } from "./channelCatalog";
import type { ChannelId } from "./types";

/** 设置页「接入方」分组（用户心智），底层仍映射到 channel */
export type AiConnectionId =
  | "vertex-site"
  | "toapis"
  | "vectorengine"
  | "openai-official"
  | "gemini-aistudio";

export type AiConnectionCatalogRow = {
  id: AiConnectionId;
  title: string;
  subtitle: string;
  /** 站内菜单可走的模型类型说明 */
  modelScope: string;
  channels: readonly ChannelId[];
  credentialKind: "site" | "api-key" | "api-key-base-url" | "multi-path";
};

export const AI_CONNECTION_CATALOG: readonly AiConnectionCatalogRow[] = [
  {
    id: "vertex-site",
    title: "Vertex · 站点代理",
    subtitle: "由站点 gemini-proxy 转发，无需自备 Google Key",
    modelScope: "站内已登记的 Google / Gemini 类模型",
    channels: ["vertex-proxy"],
    credentialKind: "site",
  },
  {
    id: "toapis",
    title: "ToAPIs 中转",
    subtitle: "一套密钥可同时走 Gemini 与 OpenAI 兼容路径",
    modelScope: "站内已登记的 Gemini 与 OpenAI 类模型（路径可分别启用）",
    channels: TOAPIS_PATH_CHANNELS,
    credentialKind: "multi-path",
  },
  {
    id: "vectorengine",
    title: "VectorEngine",
    subtitle: "Gemini REST 兼容网关",
    modelScope: "站内已登记的 Gemini 类模型",
    channels: ["vectorengine"],
    credentialKind: "api-key-base-url",
  },
  {
    id: "openai-official",
    title: "OpenAI 官方",
    subtitle: "直连 OpenAI API",
    modelScope: "站内已登记的 OpenAI 类模型",
    channels: ["openai-official"],
    credentialKind: "api-key-base-url",
  },
  {
    id: "gemini-aistudio",
    title: "Google AI Studio",
    subtitle: "Google AI Studio API Key 直连",
    modelScope: "站内已登记的 Gemini 类模型",
    channels: ["gemini-aistudio"],
    credentialKind: "api-key",
  },
] as const;

export const TOAPIS_PATH_LABELS = {
  "toapis-gemini": "Gemini 兼容路径",
  "toapis-openai": "OpenAI 兼容路径",
} as const satisfies Record<(typeof TOAPIS_PATH_CHANNELS)[number], string>;

export type AiConnectionStatus = "disabled" | "pending" | "ready" | "site-unavailable";

export function connectionEnabledChannels(
  connection: AiConnectionCatalogRow,
  enabled: readonly ChannelId[]
): ChannelId[] {
  return connection.channels.filter((ch) => enabled.includes(ch));
}

export function connectionStatus(
  connection: AiConnectionCatalogRow,
  enabled: readonly ChannelId[],
  isChannelReady: (ch: ChannelId) => boolean,
  isSiteProxyReady?: (ch: ChannelId) => boolean
): AiConnectionStatus {
  const active = connectionEnabledChannels(connection, enabled);
  if (active.length === 0) return "disabled";
  if (connection.credentialKind === "site") {
    const ch = active[0];
    if (isSiteProxyReady && !isSiteProxyReady(ch)) return "site-unavailable";
    return isChannelReady(ch) ? "ready" : "site-unavailable";
  }
  const allReady = active.every((ch) => isChannelReady(ch));
  return allReady ? "ready" : "pending";
}

export function statusLabel(status: AiConnectionStatus): { text: string; cls: string } {
  switch (status) {
    case "ready":
      return { text: "可用", cls: "text-emerald-300 ring-emerald-500/30 bg-emerald-950/30" };
    case "pending":
      return { text: "待配置", cls: "text-amber-300 ring-amber-500/30 bg-amber-950/25" };
    case "site-unavailable":
      return { text: "站点未开通", cls: "text-rose-300 ring-rose-500/35 bg-rose-950/25" };
    default:
      return { text: "未启用", cls: "text-gray-500 ring-white/[0.08] bg-white/[0.03]" };
  }
}
