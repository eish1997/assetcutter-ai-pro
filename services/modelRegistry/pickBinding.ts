import { isByokBindingChannel } from "../../shared/billingRoute";
import { getEnabledChannels, hasUserCredentialsForChannel, isChannelReady } from "../settingsStore";
import { resolveUpstreamForBinding } from "./channelCredentials";
import { wiringEdgesToProviderBindings } from "./hubGraph/compile";
import { buildHubInPorts } from "./hubGraph/hubPorts";
import { STATIC_SUPPLIER_OUTLETS } from "./hubGraph/supplierOutlets";
import { getModelOpsConfigSync } from "./opsConfig";
import { modelRegistryLog } from "./log";
import { getBindingsForRegistry } from "./providerBindings";
import { resolveUpstreamModelIdForProvider } from "./upstreamResolve";
import type { ModelResolveRole, PickedBinding, ProviderBinding } from "./types";

let hubInPortsCache: ReturnType<typeof buildHubInPorts> | null = null;

function hubInPorts(): ReturnType<typeof buildHubInPorts> {
  if (!hubInPortsCache) hubInPortsCache = buildHubInPorts();
  return hubInPortsCache;
}

function bindingsFromOpsWiringEdges(registryId: string, role: ModelResolveRole): ProviderBinding[] | null {
  const opsEdges = getModelOpsConfigSync().wiringEdges;
  if (!opsEdges?.length) return null;
  const all = wiringEdgesToProviderBindings(opsEdges, STATIC_SUPPLIER_OUTLETS, hubInPorts());
  const filtered = all.filter((b) => b.registryId === registryId && b.role === role);
  return filtered.length > 0 ? filtered : null;
}

function shouldLogPickBinding(): boolean {
  try {
    return String(
      ((import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_DEBUG_UNIFIED_AI || "").trim()
    ) === "1";
  } catch {
    return false;
  }
}

function applyOpsBindingOverrides(bindings: ProviderBinding[]): ProviderBinding[] {
  const overrides = getModelOpsConfigSync().bindingOverrides;
  if (!overrides?.length) return bindings;
  const byId = new Map(overrides.map((o) => [o.bindingId, o]));
  const next = bindings
    .map((b) => {
      const o = byId.get(b.bindingId);
      if (!o) return b;
      if (o.enabled === false) return null;
      return {
        ...b,
        priority: o.priority ?? b.priority,
        upstreamOverride: o.upstreamOverride ?? b.upstreamOverride,
      };
    })
    .filter((b): b is ProviderBinding => b != null);
  return next.sort((a, b) => a.priority - b.priority);
}

export function resolvedBindingsForRegistry(registryId: string, role: ModelResolveRole): ProviderBinding[] {
  const id = (registryId || "").trim();
  if (!id) return [];
  const base = bindingsFromOpsWiringEdges(id, role) ?? getBindingsForRegistry(id, role);
  return applyOpsBindingOverrides(base);
}

/**
 * 按 registryId + role 选第一条「已启用且 ready」的 binding。
 * Failover：固定 priority 升序，无运行时重试链；文本与生图独立选型（role=text|image）。
 */
export function pickBinding(registryId: string, role: ModelResolveRole): PickedBinding | null {
  const id = (registryId || "").trim();
  if (!id) return null;
  const enabled = new Set(getEnabledChannels());
  const bindings = resolvedBindingsForRegistry(id, role);
  const candidates: PickedBinding[] = [];
  for (const binding of bindings) {
    if (!enabled.has(binding.channel)) continue;
    if (!isChannelReady(binding.channel)) continue;
    candidates.push({
      ...binding,
      upstreamModelId: resolveUpstreamForBinding(id, role, binding, resolveUpstreamModelIdForProvider),
    });
  }
  const picked =
    candidates.find((row) => isByokBindingChannel(row.channel) && hasUserCredentialsForChannel(row.channel)) ||
    candidates[0] ||
    null;
  if (picked && shouldLogPickBinding()) {
    modelRegistryLog(
      "info",
      "picked binding",
      `${id} role=${role} channel=${picked.channel} upstream=${picked.upstreamModelId}`
    );
  }
  return picked;
}

export function hasReadyBinding(registryId: string, role: ModelResolveRole): boolean {
  return pickBinding(registryId, role) != null;
}
