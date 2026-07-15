import type { UpstreamProviderId } from "./types";
import { imageModelProviderRoute } from "./imageModels";
import { textModelFamily } from "./textModels";
import type { ChannelId, ModelFamily, ModelResolveRole, ProviderBinding } from "./types";

/** channel → resolve 层上游适配器 id */
export function channelToResolveProvider(channel: ChannelId, family: ModelFamily): UpstreamProviderId {
  switch (channel) {
    case "vertex-proxy":
      return "vertex";
    case "gemini-aistudio":
      return "gemini";
    case "toapis-gemini":
      return "toapis";
    case "toapis-openai":
      return "openai";
    case "vectorengine":
      return "vectorengine";
    case "openai-official":
    case "volcengine-ark":
      return "openai";
  }
}

export function familyForRegistry(registryId: string, role: ModelResolveRole): ModelFamily {
  if (role === "image") {
    return imageModelProviderRoute(registryId) === "openai" ? "openai" : "gemini";
  }
  return textModelFamily(registryId);
}

export function resolveUpstreamForBinding(
  registryId: string,
  role: ModelResolveRole,
  binding: ProviderBinding,
  resolveUpstreamModelIdForProvider: (
    registryId: string,
    role: ModelResolveRole,
    provider: UpstreamProviderId
  ) => string
): string {
  if (binding.upstreamOverride?.trim()) return binding.upstreamOverride.trim();
  const family = familyForRegistry(registryId, role);
  const provider = channelToResolveProvider(binding.channel, family);
  return resolveUpstreamModelIdForProvider(registryId, role, provider);
}
