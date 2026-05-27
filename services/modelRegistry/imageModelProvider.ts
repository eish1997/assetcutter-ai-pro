import {
  DEFAULT_IMAGE_MODEL_REGISTRY_ID,
  coerceImageModelRegistryId,
  imageModelProviderRoute,
  type ImageModelProviderRoute,
} from "./imageModels";
import { hasReadyBinding } from "./pickBinding";

export { hasGeminiImageProxyConfigured } from "./imageModelProviderEnv";

export function isImageModelRegistryReady(registryId: string): boolean {
  return hasReadyBinding(coerceImageModelRegistryId(registryId), "image");
}

export function isImageModelProviderRouteReady(route: ImageModelProviderRoute): boolean {
  const defaultId = route === "openai" ? "gpt-image-1.5" : DEFAULT_IMAGE_MODEL_REGISTRY_ID;
  return hasReadyBinding(defaultId, "image");
}

export function imageModelRouteDisabledReason(registryId: string): string | undefined {
  if (isImageModelRegistryReady(registryId)) return undefined;
  const route = imageModelProviderRoute(coerceImageModelRegistryId(registryId));
  if (route === "openai") return "未配置 OpenAI 通道凭证";
  return "未配置 Gemini / Vertex 通道凭证";
}
