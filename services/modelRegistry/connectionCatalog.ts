import { TOAPIS_PATH_CHANNELS } from "./channelCatalog";
import type { ChannelId } from "./types";

/** 设置页「供应商输出口」分组，底层映射到 `ChannelId` */
export type AiConnectionId =
  | "vertex-site"
  | "toapis"
  | "vectorengine"
  | "openai-official"
  | "volcengine-ark"
  | "gemini-aistudio"
  | "volcengine-jimeng";

export type AiConnectionCatalogRow = {
  id: AiConnectionId;
  title: string;
  subtitle: string;
  /** 该输出口在接线中的角色（面向用户，不按 Gemini/OpenAI 族分类） */
  outletHint: string;
  channels: readonly ChannelId[];
  credentialKind: "site" | "api-key" | "api-key-base-url" | "multi-path";
  /** W0：不在设置页展示 */
  hidden?: boolean;
};

export const AI_CONNECTION_CATALOG: readonly AiConnectionCatalogRow[] = [
  {
    id: "vertex-site",
    title: "Vertex · 站点代理",
    subtitle: "由站点 gemini-proxy 转发，无需自备 Google Key",
    outletHint: "binding 可将各 registryId 接到此站点输出口",
    channels: ["vertex-proxy"],
    credentialKind: "site",
  },
  {
    id: "toapis",
    title: "ToAPIs 中转",
    subtitle: "一套密钥的供应商网关；具体型号接线见下方「型号接线」",
    outletHint: "启用并填写凭证后，平台 binding 决定各 SKU 经此网关哪条路径发出",
    channels: TOAPIS_PATH_CHANNELS,
    credentialKind: "multi-path",
  },
  {
    id: "vectorengine",
    title: "VectorEngine",
    subtitle: "第三方 Gemini REST 兼容网关",
    outletHint: "binding 指向此处的 SKU 经 VectorEngine 上游 id 映射发出",
    channels: ["vectorengine"],
    credentialKind: "api-key-base-url",
  },
  {
    id: "openai-official",
    title: "OpenAI 官方",
    subtitle: "直连 OpenAI API",
    outletHint: "binding 指向此处的 SKU 走 OpenAI 官方 upstream",
    channels: ["openai-official"],
    credentialKind: "api-key-base-url",
  },
  {
    id: "volcengine-ark",
    title: "火山方舟",
    subtitle: "火山方舟大模型推理服务，使用 OpenAI 兼容接口",
    outletHint: "binding 指向此处的 SKU 会通过方舟兼容接口发出",
    channels: ["volcengine-ark"],
    credentialKind: "api-key-base-url",
  },
  {
    id: "gemini-aistudio",
    title: "Google AI Studio",
    subtitle: "Google AI Studio API Key 直连",
    outletHint: "binding 指向此处的 SKU 走 AI Studio 直连",
    channels: ["gemini-aistudio"],
    credentialKind: "api-key",
  },
  {
    id: "volcengine-jimeng",
    title: "火山引擎 · 即梦",
    subtitle: "站点统一 AK；W0 不在设置页展示",
    outletHint: "binding 可将 jimeng 图类 SKU 接到此站点输出口",
    channels: ["volcengine-jimeng"],
    credentialKind: "site",
    hidden: true,
  },
] as const;

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
