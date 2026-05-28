import type { UpstreamProviderId } from "./types";
import {
  coerceImageModelRegistryId,
  imageModelProviderRoute,
  isKnownImageModelRegistryInput,
  type ImageModelProviderRoute,
} from "./imageModels";
import { channelToResolveProvider, familyForRegistry } from "./channelCredentials";
import { getBindingsForRegistry } from "./providerBindings";
import { pickBinding } from "./pickBinding";
import type { ModelResolveRole } from "./types";
import { resolveUpstreamModelIdForProvider } from "./upstreamResolve";

export type { ModelResolveRole } from "./types";
export { resolveUpstreamModelIdForProvider } from "./upstreamResolve";

function aiProviderForImageModelRoute(route: ImageModelProviderRoute): UpstreamProviderId {
  return route === "openai" ? "openai" : "gemini";
}

/** 无 ready binding 时：按 family 默认 channel 映射 upstream（不读 getAiProvider） */
function resolveUpstreamWithoutReadyBinding(registryId: string, role: ModelResolveRole): string {
  const bindings = getBindingsForRegistry(registryId, role);
  const first = bindings[0];
  if (!first) return registryId;
  const family = familyForRegistry(registryId, role);
  const provider = channelToResolveProvider(first.channel, family);
  return resolveUpstreamModelIdForProvider(registryId, role, provider);
}

/**
 * 按生图 registryId 的 binding 解析上游 model id。
 */
export function resolveUpstreamImageModelIdForRegistry(registryId: string): string {
  const id = coerceImageModelRegistryId(registryId);
  const picked = pickBinding(id, "image");
  if (picked) return picked.upstreamModelId;
  const route = imageModelProviderRoute(id);
  return resolveUpstreamModelIdForProvider(id, "image", aiProviderForImageModelRoute(route));
}

export function resolveUpstreamModelId(registryId: string, role: ModelResolveRole): string {
  const id = (registryId || "").trim();
  if (!id) return registryId;
  const picked = pickBinding(id, role);
  if (picked) return picked.upstreamModelId;
  return resolveUpstreamWithoutReadyBinding(id, role);
}

export function resolveUpstreamTextModelId(internalModel: string): string {
  return resolveUpstreamModelId(internalModel, "text");
}

export function resolveUpstreamImageModelId(internalModel: string): string {
  const m = (internalModel || "").trim();
  if (isKnownImageModelRegistryInput(m)) {
    return resolveUpstreamImageModelIdForRegistry(m);
  }
  return resolveUpstreamModelId(internalModel, "image");
}
