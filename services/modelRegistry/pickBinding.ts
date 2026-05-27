import { getEnabledChannels, isChannelReady } from "../settingsStore";
import { resolveUpstreamForBinding } from "./channelCredentials";
import { getModelOpsConfigSync } from "./opsConfig";
import { modelRegistryLog } from "./log";
import { getBindingsForRegistry } from "./providerBindings";
import { resolveUpstreamModelIdForProvider } from "./upstreamResolve";
import type { ModelResolveRole, PickedBinding, ProviderBinding } from "./types";

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

export function pickBinding(registryId: string, role: ModelResolveRole): PickedBinding | null {
  const id = (registryId || "").trim();
  if (!id) return null;
  const enabled = new Set(getEnabledChannels());
  const bindings = applyOpsBindingOverrides(getBindingsForRegistry(id, role));
  for (const binding of bindings) {
    if (!enabled.has(binding.channel)) continue;
    if (!isChannelReady(binding.channel)) continue;
    const picked: PickedBinding = {
      ...binding,
      upstreamModelId: resolveUpstreamForBinding(id, role, binding, resolveUpstreamModelIdForProvider),
    };
    if (shouldLogPickBinding()) {
      modelRegistryLog(
        "info",
        "picked binding",
        `${id} role=${role} channel=${binding.channel} upstream=${picked.upstreamModelId}`
      );
    }
    return picked;
  }
  return null;
}

export function hasReadyBinding(registryId: string, role: ModelResolveRole): boolean {
  return pickBinding(registryId, role) != null;
}
