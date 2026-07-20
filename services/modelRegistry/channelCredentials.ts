import type { UpstreamProviderId } from "./types";
import { imageModelProviderRoute } from "./imageModels";
import { isRegisteredJimengImageModelId } from "./jimengImageRegistry";
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
      return "openai";
    case "tinysnow-openai":
      return "tinysnow";
    case "volcengine-ark":
      return "volcengine-ark";
    case "volcengine-jimeng":
      return "volcengine-jimeng";
  }
}

export function familyForRegistry(registryId: string, role: ModelResolveRole): ModelFamily {
  if (role === "image") {
    if (isRegisteredJimengImageModelId(registryId) || /^jimeng-image-/i.test(registryId)) return "volcengine-jimeng";
    if (/^doubao-seedream-/i.test(registryId)) return "volcengine-ark";
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
