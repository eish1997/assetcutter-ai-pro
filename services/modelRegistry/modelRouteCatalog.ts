import { JIMENG_CATALOG } from "../jimeng/catalog";
import { PROVIDER_BINDINGS } from "./providerBindings";
import { AGGREGATOR_302AI_MULTIMODAL_CATALOG, VOLCENGINE_ARK_MODEL_CATALOG, listProviderModels, type ProviderModelCatalogEntry } from "./providerModelCatalog";
import { resolveCatalogGatewayExecutionStatus } from "../../shared/aiGatewayModelRoutes.js";
import type { ChannelId } from "./types";
import type { ProviderCatalogId, ProviderModality } from "./providerCatalog";

export type ModelRouteFallbackPolicy =
  | "none"
  | "on_error"
  | "on_rate_limit"
  | "on_timeout"
  | "on_provider_degraded"
  | "cost_optimized"
  | "quality_first";
export type ModelRouteExecutionStatus =
  | "platform_ready"
  | "byok_ready"
  | "requires_endpoint_mapping"
  | "adapter_pending"
  | "disabled";
export type ModelRouteGatewayExecutionStatus = "ready" | "adapter_pending" | "not_published";

export type ModelRouteCatalogEntry = {
  routeId: string;
  canonicalModelId: string;
  providerId: ProviderCatalogId;
  providerModelId: string;
  modality: ProviderModality;
  enabled: boolean;
  priority: number;
  fallbackPolicy: ModelRouteFallbackPolicy;
  source: "provider-binding" | "static";
  executionStatus: ModelRouteExecutionStatus;
  gatewayExecutionStatus: ModelRouteGatewayExecutionStatus;
  channel?: ChannelId;
  requiresEndpointMapping?: boolean;
};

const CHANNEL_PROVIDER_MAP: Record<ChannelId, ProviderCatalogId> = {
  "vertex-proxy": "vertex-site",
  "gemini-aistudio": "gemini-aistudio",
  "toapis-gemini": "toapis",
  "toapis-openai": "toapis",
  "302ai-openai": "302ai",
  "aihubmix-openai": "aihubmix",
  "tinysnow-openai": "tinysnow",
  vectorengine: "vectorengine",
  "openai-official": "openai-official",
  "volcengine-ark": "volcengine-ark",
  "volcengine-jimeng": "volcengine-jimeng",
};

function providerModelFor(providerId: ProviderCatalogId, registryId: string): ProviderModelCatalogEntry | undefined {
  return listProviderModels(providerId).find((row) => row.registryId === registryId);
}

function bindingModality(role: "text" | "image"): ProviderModality {
  return role === "text" ? "text" : "image";
}

function routeExecutionStatus(row: {
  providerId: ProviderCatalogId;
  enabled: boolean;
  requiresEndpointMapping?: boolean;
  channel?: ChannelId;
}): ModelRouteExecutionStatus {
  if (!row.enabled) return "disabled";
  if (row.requiresEndpointMapping) return "requires_endpoint_mapping";
  if (
    row.providerId === "vertex-site" ||
    row.providerId === "volcengine-jimeng" ||
    row.providerId === "tripo" ||
    row.providerId === "openai-official" ||
    row.providerId === "302ai" ||
    row.providerId === "aihubmix" ||
    row.providerId === "tinysnow"
  ) {
    return "platform_ready";
  }
  if (row.providerId === "toapis" && row.channel === "toapis-openai") return "platform_ready";
  if (
    row.providerId === "toapis" ||
    row.providerId === "gemini-aistudio" ||
    row.providerId === "vectorengine"
  ) {
    return "byok_ready";
  }
  return "adapter_pending";
}

function buildBindingRoutes(): ModelRouteCatalogEntry[] {
  return PROVIDER_BINDINGS.map((binding) => {
    const providerId = CHANNEL_PROVIDER_MAP[binding.channel];
    const providerModel = providerModelFor(providerId, binding.registryId);
    const enabled = binding.defaultEnabled !== false;
    const requiresEndpointMapping = providerModel?.requiresEndpointMapping;
    return {
      routeId: `${binding.registryId}:${providerId}:${binding.role}`,
      canonicalModelId: binding.registryId,
      providerId,
      providerModelId: binding.upstreamOverride || providerModel?.providerModelId || binding.registryId,
      modality: bindingModality(binding.role),
      enabled,
      priority: binding.priority,
      fallbackPolicy: binding.priority <= 10 ? "none" : "on_error",
      source: "provider-binding" as const,
      executionStatus: routeExecutionStatus({ providerId, enabled, requiresEndpointMapping, channel: binding.channel }),
      gatewayExecutionStatus: resolveCatalogGatewayExecutionStatus({
        canonicalModelId: binding.registryId,
        providerId,
        modality: bindingModality(binding.role),
      }) as ModelRouteGatewayExecutionStatus,
      channel: binding.channel,
      requiresEndpointMapping,
    };
  });
}

function buildJimengNonImageRoutes(): ModelRouteCatalogEntry[] {
  return JIMENG_CATALOG.filter((row) => row.modality !== "image").map((row, index) => ({
    routeId: `${row.registryId}:volcengine-jimeng:${row.modality}`,
    canonicalModelId: row.registryId,
    providerId: "volcengine-jimeng" as const,
    providerModelId: row.upstreamReqKey,
    modality: row.modality === "digital_human" ? ("digital_human" as const) : row.modality,
    enabled: row.verified === true,
    priority: 10 + index,
    fallbackPolicy: "none" as const,
    source: "static" as const,
    executionStatus: routeExecutionStatus({
      providerId: "volcengine-jimeng",
      enabled: row.verified === true,
    }),
    gatewayExecutionStatus: resolveCatalogGatewayExecutionStatus({
      canonicalModelId: row.registryId,
      providerId: "volcengine-jimeng",
      modality: row.modality === "digital_human" ? "digital_human" : row.modality,
    }) as ModelRouteGatewayExecutionStatus,
  }));
}

function buildArkRoutes(): ModelRouteCatalogEntry[] {
  return VOLCENGINE_ARK_MODEL_CATALOG.map((row, index) => {
    const gatewayExecutionStatus = resolveCatalogGatewayExecutionStatus({
      canonicalModelId: row.registryId || row.providerModelId,
      providerId: "volcengine-ark",
      modality: row.modality,
    }) as ModelRouteGatewayExecutionStatus;
    return {
      routeId: `${row.registryId || row.providerModelId}:volcengine-ark:${row.modality}`,
      canonicalModelId: row.registryId || row.providerModelId,
      providerId: "volcengine-ark" as const,
      providerModelId: row.providerModelId,
      modality: row.modality,
      enabled: true,
      priority: 20 + index,
      fallbackPolicy: "on_error" as const,
      source: "static" as const,
      executionStatus: gatewayExecutionStatus === "ready" ? ("platform_ready" as const) : ("adapter_pending" as const),
      gatewayExecutionStatus,
    };
  });
}

function buildAggregatorGrayRoutes(): ModelRouteCatalogEntry[] {
  return AGGREGATOR_302AI_MULTIMODAL_CATALOG.map((row, index) => ({
    routeId: `${row.registryId || row.providerModelId}:302ai:${row.modality}`,
    canonicalModelId: row.registryId || row.providerModelId,
    providerId: "302ai" as const,
    providerModelId: row.providerModelId,
    modality: row.modality,
    enabled: false,
    priority: 70 + index,
    fallbackPolicy: "none" as const,
    source: "static" as const,
    executionStatus: "requires_endpoint_mapping" as const,
    gatewayExecutionStatus: "adapter_pending" as const,
    requiresEndpointMapping: true,
  }));
}

function buildTripoRoutes(): ModelRouteCatalogEntry[] {
  return listProviderModels("tripo")
    .filter((row) => row.modality === "model3d")
    .map((row, index) => ({
      routeId: `${row.registryId || row.providerModelId}:tripo:model3d`,
      canonicalModelId: row.registryId || row.providerModelId,
      providerId: "tripo" as const,
      providerModelId: row.providerModelId,
      modality: "model3d" as const,
      enabled: row.status !== "disabled",
      priority: 10 + index,
      fallbackPolicy: "none" as const,
      source: "static" as const,
      executionStatus: routeExecutionStatus({
        providerId: "tripo",
        enabled: row.status !== "disabled",
      }),
      gatewayExecutionStatus: resolveCatalogGatewayExecutionStatus({
        canonicalModelId: row.registryId || row.providerModelId,
        providerId: "tripo",
        modality: "model3d",
      }) as ModelRouteGatewayExecutionStatus,
    }));
}

const MODEL3D_ROUTES: readonly ModelRouteCatalogEntry[] = [
  {
    routeId: "tencent-hunyuan-3d-pro:tencent-hunyuan:model3d",
    canonicalModelId: "tencent-hunyuan-3d-pro",
    providerId: "tencent-hunyuan",
    providerModelId: "hunyuan-to-3d-pro",
    modality: "model3d",
    enabled: true,
    priority: 10,
    fallbackPolicy: "none",
    source: "static",
    executionStatus: "platform_ready",
    gatewayExecutionStatus: "ready",
  },
  {
    routeId: "tencent-hunyuan-3d-rapid:tencent-hunyuan:model3d",
    canonicalModelId: "tencent-hunyuan-3d-rapid",
    providerId: "tencent-hunyuan",
    providerModelId: "hunyuan-to-3d-rapid",
    modality: "model3d",
    enabled: true,
    priority: 20,
    fallbackPolicy: "none",
    source: "static",
    executionStatus: "platform_ready",
    gatewayExecutionStatus: "ready",
  },
];

function uniqueRoutes(rows: readonly ModelRouteCatalogEntry[]): ModelRouteCatalogEntry[] {
  const out: ModelRouteCatalogEntry[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.routeId)) continue;
    seen.add(row.routeId);
    out.push(row);
  }
  return out.sort((a, b) => a.canonicalModelId.localeCompare(b.canonicalModelId) || a.priority - b.priority);
}

export const MODEL_ROUTE_CATALOG: readonly ModelRouteCatalogEntry[] = uniqueRoutes([
  ...buildBindingRoutes(),
  ...buildArkRoutes(),
  ...buildAggregatorGrayRoutes(),
  ...buildJimengNonImageRoutes(),
  ...buildTripoRoutes(),
  ...MODEL3D_ROUTES,
]);

export function listModelRoutes(canonicalModelId?: string): ModelRouteCatalogEntry[] {
  const id = String(canonicalModelId || "").trim();
  if (!id) return [...MODEL_ROUTE_CATALOG];
  return MODEL_ROUTE_CATALOG.filter((row) => row.canonicalModelId === id);
}

export function listProviderRoutes(providerId: string): ModelRouteCatalogEntry[] {
  const id = String(providerId || "").trim();
  return MODEL_ROUTE_CATALOG.filter((row) => row.providerId === id);
}

export function providerRouteCount(providerId: string): number {
  return listProviderRoutes(providerId).length;
}

export function routeProvidersForCanonicalModel(canonicalModelId: string): ProviderCatalogId[] {
  const seen = new Set<ProviderCatalogId>();
  const out: ProviderCatalogId[] = [];
  for (const route of listModelRoutes(canonicalModelId)) {
    if (seen.has(route.providerId)) continue;
    seen.add(route.providerId);
    out.push(route.providerId);
  }
  return out;
}
