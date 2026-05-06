import type { AiProvider } from "../settingsStore";
import { getAiProvider } from "../settingsStore";

export type ModelResolveRole = "text" | "image";

/**
 * 统一解析：站内 registryId（策略 A 下与上游 id 同名）→ 当前渠道实际上游 model id。
 * ToAPIs 特化映射仍在 `toapisAdapter` 内；此处**不再**改写 ToAPIs，避免双重映射（geminiService 注释原约定）。
 *
 * @see docs/多模型可运营改造计划.md
 */
export function resolveUpstreamModelIdForProvider(
  registryId: string,
  role: ModelResolveRole,
  provider: AiProvider
): string {
  const m = (registryId || "").trim();
  if (!m) return registryId;
  const ml = m.toLowerCase();

  if (role === "text") {
    if (provider === "openai") {
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

  if (provider === "openai") {
    if (ml.includes("gpt-image") || ml.includes("dall-e")) return m;
    return "gpt-image-1";
  }

  if (provider === "antigravity") {
    if (ml.includes("gemini-3.1-flash-image-preview")) return "gemini-3.1-flash-image";
    if (ml.includes("gemini-3-pro-image-preview")) return "gemini-3-pro-image";
    return m;
  }
  if (provider === "vectorengine") {
    if (ml.includes("gemini-3.1-flash-image-preview") || ml.includes("gemini-3-pro-image-preview")) {
      return "gemini-2.5-flash-image";
    }
  }
  return m;
}

export function resolveUpstreamModelId(registryId: string, role: ModelResolveRole): string {
  return resolveUpstreamModelIdForProvider(registryId, role, getAiProvider());
}

/**
 * 部分第三方 Gemini 网关（尤其 VectorEngine）对 `gemini-3-flash-preview` 等预览 id 会返回含
 * “valid … user model” 类 4xx；能力与对话里的「理解 / 纯文本」在此回退到更通用的模型 id。
 */
export function resolveUpstreamTextModelId(internalModel: string): string {
  return resolveUpstreamModelId(internalModel, "text");
}

/**
 * 部分第三方网关不认站内「预览」生图 id（易 404 Requested entity was not found）：
 * - VectorEngine → 回退 `gemini-2.5-flash-image`。
 * - Antigravity → 映射到控制台模型 id。
 * - ToAPIs 在 `toapisAdapter` 内单独映射，此处不再改写。
 */
export function resolveUpstreamImageModelId(internalModel: string): string {
  return resolveUpstreamModelId(internalModel, "image");
}
