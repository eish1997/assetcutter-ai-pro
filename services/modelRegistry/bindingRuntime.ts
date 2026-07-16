import { DEFAULT_MODEL_TEXT } from "./constants";
import { DEFAULT_IMAGE_MODEL_REGISTRY_ID, isRegisteredImageModelId } from "./imageModels";
import { pickBinding } from "./pickBinding";
import type { ChannelId, ModelResolveRole } from "./types";

export function isVertexProxyChannel(channel: ChannelId | null | undefined): boolean {
  return channel === "vertex-proxy";
}

export function pickChannel(registryId: string, role: ModelResolveRole): ChannelId | null {
  return pickBinding(registryId, role)?.channel ?? null;
}

/** 当前 registryId + role 是否走 Vertex 站点代理 channel */
export function usesVertexProxyFor(registryId: string, role: ModelResolveRole): boolean {
  return isVertexProxyChannel(pickChannel(registryId, role));
}

export function usesVertexProxyForImage(modelOrRegistryId?: string): boolean {
  const raw = (modelOrRegistryId || DEFAULT_IMAGE_MODEL_REGISTRY_ID).trim();
  const id = isRegisteredImageModelId(raw) ? raw : raw;
  return usesVertexProxyFor(id, "image");
}

export function usesVertexProxyForText(modelOrRegistryId?: string): boolean {
  return usesVertexProxyFor((modelOrRegistryId || DEFAULT_MODEL_TEXT).trim(), "text");
}

/** AI Worker Proxy 是否应带 aiBackend: vertex（默认看生图 binding，文本代理场景可传 role） */
export function aiWorkerProxyUsesVertexBackend(registryId: string, role: ModelResolveRole = "image"): boolean {
  return usesVertexProxyFor(registryId, role);
}
