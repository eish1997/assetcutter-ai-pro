import { JIMENG_IMAGE_REGISTRY } from "./jimengImageRegistry";
import type { ChannelId, ModelResolveRole, ProviderBinding } from "./types";

export const JIMENG_IMAGE_CHANNEL: ChannelId = "volcengine-jimeng";

const JIMENG_IMAGE_ROLE: ModelResolveRole = "image";

function bindingForJimengImageRegistry(registryId: string): ProviderBinding {
  return {
    bindingId: `${registryId}:${JIMENG_IMAGE_CHANNEL}:${JIMENG_IMAGE_ROLE}`,
    registryId,
    role: JIMENG_IMAGE_ROLE,
    channel: JIMENG_IMAGE_CHANNEL,
    priority: 10,
    defaultEnabled: false,
  };
}

/** 图类 jimeng SKU → volcengine-jimeng 唯一 binding 链 */
export const JIMENG_IMAGE_BINDINGS: readonly ProviderBinding[] = JIMENG_IMAGE_REGISTRY.map((e) =>
  bindingForJimengImageRegistry(e.registryId)
);

export function getJimengImageBindingsForRegistry(registryId: string): ProviderBinding[] {
  const id = (registryId || "").trim();
  if (!id) return [];
  return JIMENG_IMAGE_BINDINGS.filter((b) => b.registryId === id);
}

export function isJimengImageBinding(binding: ProviderBinding): boolean {
  return binding.channel === JIMENG_IMAGE_CHANNEL && binding.role === JIMENG_IMAGE_ROLE;
}
