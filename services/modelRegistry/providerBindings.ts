import {
  DIALOG_IMAGE_REGISTRY,
  coerceImageModelRegistryId,
  imageModelProviderRoute,
  isRegisteredImageModelId,
} from "./imageModels";
import { JIMENG_IMAGE_BINDINGS, getJimengImageBindingsForRegistry } from "./jimengBindings";
import { isRegisteredJimengImageModelId } from "./jimengImageRegistry";
import { TEXT_MODEL_REGISTRY, textModelFamily } from "./textModels";
import type { ChannelId, ModelFamily, ModelResolveRole, ProviderBinding } from "./types";

type ChannelTemplate = {
  channel: ChannelId;
  priority: number;
  defaultEnabled?: boolean;
};

const GEMINI_CHANNELS: readonly ChannelTemplate[] = [
  { channel: "vertex-proxy", priority: 10, defaultEnabled: true },
  { channel: "toapis-gemini", priority: 20 },
  { channel: "vectorengine", priority: 30 },
  { channel: "gemini-aistudio", priority: 40, defaultEnabled: false },
];

const OPENAI_CHANNELS: readonly ChannelTemplate[] = [
  { channel: "openai-official", priority: 10, defaultEnabled: true },
  { channel: "toapis-openai", priority: 20 },
];

function familyForBindingRegistry(registryId: string, role: ModelResolveRole): ModelFamily {
  if (role === "image") {
    if (isRegisteredJimengImageModelId(registryId)) return "volcengine-jimeng";
    if (isRegisteredImageModelId(registryId)) {
      return imageModelProviderRoute(registryId) === "openai" ? "openai" : "gemini";
    }
    const ml = registryId.toLowerCase();
    if (ml.includes("gpt-image") || ml.includes("dall-e")) return "openai";
    return "gemini";
  }
  return textModelFamily(registryId);
}

function bindingsForRegistry(
  registryId: string,
  role: ModelResolveRole,
  family: ModelFamily
): ProviderBinding[] {
  if (family === "volcengine-jimeng" && role === "image") {
    return getJimengImageBindingsForRegistry(registryId);
  }
  const templates = family === "openai" ? OPENAI_CHANNELS : GEMINI_CHANNELS;
  return templates.map(({ channel, priority, defaultEnabled }) => ({
    bindingId: `${registryId}:${channel}:${role}`,
    registryId,
    role,
    channel,
    priority,
    defaultEnabled,
  }));
}

function buildProviderBindings(): ProviderBinding[] {
  const out: ProviderBinding[] = [];
  for (const e of DIALOG_IMAGE_REGISTRY) {
    out.push(...bindingsForRegistry(e.registryId, "image", e.providerRoute));
  }
  for (const e of TEXT_MODEL_REGISTRY) {
    out.push(...bindingsForRegistry(e.registryId, "text", e.family));
  }
  out.push(...JIMENG_IMAGE_BINDINGS);
  return out;
}

export const PROVIDER_BINDINGS: readonly ProviderBinding[] = buildProviderBindings();

/** 未知 registryId 时按 family 合成 binding 链（P1 兜底） */
export function getFamilyBindingsForRegistry(registryId: string, role: ModelResolveRole): ProviderBinding[] {
  const id = (registryId || "").trim();
  if (!id) return [];
  const family = familyForBindingRegistry(id, role);
  const canonicalId =
    role === "image" && isRegisteredImageModelId(id) ? coerceImageModelRegistryId(id) : id;
  return bindingsForRegistry(canonicalId, role, family);
}

export function getBindingsForRegistry(registryId: string, role: ModelResolveRole): ProviderBinding[] {
  const id = (registryId || "").trim();
  if (!id) return [];
  const exact = PROVIDER_BINDINGS.filter((b) => b.registryId === id && b.role === role);
  if (exact.length > 0) return exact.sort((a, b) => a.priority - b.priority);
  return getFamilyBindingsForRegistry(id, role);
}

export function defaultEnabledChannelIds(): ChannelId[] {
  const seen = new Set<ChannelId>();
  const out: ChannelId[] = [];
  for (const b of PROVIDER_BINDINGS) {
    if (!b.defaultEnabled || seen.has(b.channel)) continue;
    seen.add(b.channel);
    out.push(b.channel);
  }
  return out;
}
