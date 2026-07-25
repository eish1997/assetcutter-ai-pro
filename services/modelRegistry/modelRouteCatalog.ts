import { JIMENG_CATALOG } from "../jimeng/catalog";
import { PROVIDER_BINDINGS } from "./providerBindings";
import { AGGREGATOR_302AI_MULTIMODAL_CATALOG, VOLCENGINE_ARK_MODEL_CATALOG, listProviderModels, type ProviderModelCatalogEntry } from "./providerModelCatalog";
import {
  normalizeCatalogRouteCandidateStatus,
  resolveCatalogGatewayExecutionStatus,
  resolveExecutableAiGatewayModelRoute,
} from "../../shared/aiGatewayModelRoutes.js";
import { getModelOpsConfigSync } from "./opsConfig";
import { isProviderCatalogId, type ProviderCatalogId, type ProviderModality } from "./providerCatalog";
import type { ChannelId } from "./types";

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
    modality: row.modality,
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
      modality: row.modality,
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

function gatewayRouteConfigKey(canonicalModelId: string, providerId: string, modality?: string) {
  const model = String(canonicalModelId || "").trim();
  const provider = String(providerId || "").trim();
  const mod = String(modality || "").trim();
  if (!model || !provider) return "";
  return mod ? `${model}:${provider}:${mod}` : `${model}:${provider}`;
}

/**
 * B1: same authority chain as server `listGatewayRouteConfigs` /
 * `materializeGatewayRouteConfigRow`:
 * explicit ops status → executable seed status → catalog base → ready.
 */
function resolveOverlayGatewayExecutionStatus(
  cfg: { gatewayExecutionStatus?: string },
  input: { canonicalModelId: string; providerId: string; modality?: string },
  catalogBase?: ModelRouteCatalogEntry
): ModelRouteGatewayExecutionStatus {
  const fromOps = normalizeCatalogRouteCandidateStatus(cfg.gatewayExecutionStatus);
  if (fromOps === "ready" || fromOps === "adapter_pending" || fromOps === "not_published") {
    return fromOps;
  }
  const executable = resolveExecutableAiGatewayModelRoute(
    {
      canonicalModelId: input.canonicalModelId,
      providerId: input.providerId,
      modality: input.modality,
    },
    { providerField: "catalogProviderIds" }
  );
  if (executable) {
    return (normalizeCatalogRouteCandidateStatus(executable.gatewayExecutionStatus) ||
      catalogBase?.gatewayExecutionStatus ||
      "ready") as ModelRouteGatewayExecutionStatus;
  }
  // No executable seed: materializeGatewayRouteConfigRow defaults missing status to ready.
  return "ready";
}

function executionStatusForGatewayOverlay(
  enabled: boolean,
  gatewayExecutionStatus: ModelRouteGatewayExecutionStatus,
  catalogBase?: ModelRouteCatalogEntry
): ModelRouteExecutionStatus {
  if (!enabled) return "disabled";
  if (catalogBase?.requiresEndpointMapping) return "requires_endpoint_mapping";
  if (gatewayExecutionStatus === "ready") return "platform_ready";
  if (gatewayExecutionStatus === "adapter_pending") return "adapter_pending";
  return catalogBase?.executionStatus && catalogBase.executionStatus !== "disabled"
    ? catalogBase.executionStatus
    : "adapter_pending";
}

/**
 * A1/B1: overlay ops `gatewayRouteConfigs` onto the static catalog so Admin/workspace
 * display the same enabled/priority/providerModelId/gatewayExecutionStatus decision uses.
 */
function applyGatewayRouteConfigOverlay(routes: ModelRouteCatalogEntry[]): ModelRouteCatalogEntry[] {
  const configs = getModelOpsConfigSync().gatewayRouteConfigs;
  if (!Array.isArray(configs) || configs.length === 0) return routes;

  const byKey = new Map<string, ModelRouteCatalogEntry>();
  for (const route of routes) {
    const key = gatewayRouteConfigKey(route.canonicalModelId, route.providerId, route.modality);
    if (key) byKey.set(key, route);
  }

  for (const cfg of configs) {
    const canonicalModelId = String(cfg.canonicalModelId || "").trim();
    const providerIdRaw = String(cfg.providerId || "").trim();
    if (!canonicalModelId || !providerIdRaw || !isProviderCatalogId(providerIdRaw)) continue;
    const providerId = providerIdRaw as ProviderCatalogId;
    const modality = (String(cfg.modality || "").trim() || undefined) as ProviderModality | undefined;
    const key = gatewayRouteConfigKey(canonicalModelId, providerId, modality);
    if (!key) continue;
    const base = byKey.get(key);
    const upstream =
      (typeof cfg.upstreamModelId === "string" && cfg.upstreamModelId.trim()) ||
      (typeof cfg.providerModelId === "string" && cfg.providerModelId.trim()) ||
      "";
    const gatewayExecutionStatus = resolveOverlayGatewayExecutionStatus(
      cfg,
      { canonicalModelId, providerId, modality: modality || base?.modality },
      base
    );
    if (base) {
      const enabled = cfg.enabled === undefined ? base.enabled : cfg.enabled === true;
      const priority =
        typeof cfg.priority === "number" && Number.isFinite(cfg.priority) ? Math.floor(cfg.priority) : base.priority;
      byKey.set(key, {
        ...base,
        enabled,
        priority,
        ...(upstream ? { providerModelId: upstream } : {}),
        gatewayExecutionStatus,
        executionStatus: executionStatusForGatewayOverlay(enabled, gatewayExecutionStatus, base),
      });
      continue;
    }
    if (!modality) continue;
    const enabled = cfg.enabled !== false;
    byKey.set(key, {
      routeId: `${canonicalModelId}:${providerId}:${modality}`,
      canonicalModelId,
      providerId,
      providerModelId: upstream || canonicalModelId,
      modality,
      enabled,
      priority: typeof cfg.priority === "number" && Number.isFinite(cfg.priority) ? Math.floor(cfg.priority) : 100,
      fallbackPolicy: "on_error",
      source: "static",
      gatewayExecutionStatus,
      executionStatus: executionStatusForGatewayOverlay(enabled, gatewayExecutionStatus),
    });
  }

  return [...byKey.values()].sort(
    (a, b) => a.canonicalModelId.localeCompare(b.canonicalModelId) || a.priority - b.priority
  );
}

export function listModelRoutes(canonicalModelId?: string): ModelRouteCatalogEntry[] {
  const id = String(canonicalModelId || "").trim();
  const base = id ? MODEL_ROUTE_CATALOG.filter((row) => row.canonicalModelId === id) : [...MODEL_ROUTE_CATALOG];
  const overlaid = applyGatewayRouteConfigOverlay(base);
  if (!id) return overlaid;
  return overlaid.filter((row) => row.canonicalModelId === id);
}

export function listProviderRoutes(providerId: string): ModelRouteCatalogEntry[] {
  const id = String(providerId || "").trim();
  return listModelRoutes().filter((row) => row.providerId === id);
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
