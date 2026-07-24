/**
 * 运营侧模型策略（可由远端 JSON 覆盖，见 opsConfig.ts）。
 * `imageRegistryAllowlist === null | undefined` 表示不限制（全量注册表）。
 */
import type { WiringEdge } from "./hubGraph/types";

export type ModelOpsConfig = {
  version: number;
  imageRegistryAllowlist?: string[] | null;
  /** Canonical model ids published to workspace pickers; null/undefined means all published catalog models. */
  publishedCanonicalModelAllowlist?: string[] | null;
  /** 当前模型不可用时按 registryId 顺序回退 */
  imageModelPreference?: string[] | null;
  /** 运营侧 binding 覆盖（禁用 / 调优先级 / 上游 id） */
  bindingOverrides?: Array<{
    bindingId: string;
    enabled?: boolean;
    priority?: number;
    fallbackPolicy?:
      | "none"
      | "on_error"
      | "on_rate_limit"
      | "on_timeout"
      | "on_provider_degraded"
      | "cost_optimized"
      | "quality_first";
    fallbackMaxAttempts?: number;
    upstreamOverride?: string;
  }> | null;
  /** 供应商级运行覆盖；用于统一调整聚合商 Base URL，避免逐个 key 修改 */
  providerOverrides?: Array<{
    providerId: string;
    baseUrl?: string;
    requestTimeoutMs?: number;
  }> | null;
  /** 聚合商灰度路线的 endpoint 映射配置；缺必填字段时仍视为参数待补齐 */
  endpointMappings?: Array<{
    routeId: string;
    method?: "GET" | "POST";
    requestPath?: string;
    pollPath?: string;
    statusPath?: string;
    artifactPath?: string;
    taskIdPath?: string;
    errorPath?: string;
    statusValuePath?: string;
    artifactUrlPath?: string;
    upstreamOverride?: string;
    priority?: number;
    enabled?: boolean;
  }> | null;
  /** 枢纽边表：存在且某 SKU 有边时，优先于静态 providerBindings */
  wiringEdges?: WiringEdge[] | null;
  /**
   * A1: Gateway executable route authority mirrored into the browser catalog.
   * When present, listModelRoutes overlays enabled/priority/providerModelId.
   */
  gatewayRouteConfigs?: Array<{
    canonicalModelId: string;
    providerId: string;
    modality?: string;
    enabled?: boolean;
    priority?: number;
    upstreamModelId?: string;
    providerModelId?: string;
  }> | null;
  /** @deprecated 请用 `imageModelPreference`（gear id 会在读取时迁移为 registryId） */
  gearPreference?: string[];
};
