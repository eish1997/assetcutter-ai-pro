import type { UpstreamProviderId } from "./types";
import type { ModelResolveRole } from "./types";

/**
 * 统一解析：站内 registryId（策略 A 下与上游 id 同名）→ 当前渠道实际上游 model id。
 * ToAPIs 特化映射仍在 `toapisAdapter` 内；此处**不再**改写 ToAPIs，避免双重映射。
 */
export function resolveUpstreamModelIdForProvider(
  registryId: string,
  role: ModelResolveRole,
  provider: UpstreamProviderId
): string {
  const m = (registryId || "").trim();
  if (!m) return registryId;
  const ml = m.toLowerCase();

  if (role === "text") {
    if (provider === "volcengine-ark" || provider === "volcengine-jimeng") return m;
    if (provider === "openai" || provider === "tinysnow") {
      if (ml.startsWith("gpt-") || ml.startsWith("o1") || ml.startsWith("o3") || ml.startsWith("o4")) return m;
      if (ml.includes("pro-preview") || ml.includes("3-pro")) return "gpt-4o";
      if (ml.includes("flash")) return "gpt-4o-mini";
      return "gpt-4o-mini";
    }
    if (provider === "vectorengine") {
      if (ml.includes("gemini-3-flash-preview")) return "gemini-2.5-flash";
      if (ml.includes("gemini-3-pro-preview")) return "gemini-2.5-pro";
    }
    return m;
  }

  if (provider === "volcengine-ark" || provider === "volcengine-jimeng") return m;

  if (provider === "openai" || provider === "tinysnow") {
    if (ml.includes("gpt-image") || ml.includes("dall-e")) {
      if (ml === "gpt-image-1" || ml.startsWith("dall-e")) return "gpt-image-1.5";
      return m;
    }
    return "gpt-image-1.5";
  }

  if (provider === "antigravity") {
    if (ml.includes("gemini-3.1-flash-image-preview") || ml.includes("gemini-3.1-flash-image")) {
      return "gemini-3.1-flash-image";
    }
    if (ml.includes("gemini-3-pro-image-preview") || ml.includes("gemini-3-pro-image")) {
      return "gemini-3-pro-image";
    }
    return m;
  }
  if (provider === "vectorengine") {
    if (ml.includes("gemini-3.1-flash-image-preview") || ml.includes("gemini-3-pro-image-preview")) {
      return "gemini-2.5-flash-image";
    }
  }
  return m;
}
