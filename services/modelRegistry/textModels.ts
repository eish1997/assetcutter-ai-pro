import { DEFAULT_MODEL_TEXT } from "./constants";
import type { ModelFamily } from "./types";

export type TextModelRegistryEntry = {
  registryId: string;
  label: string;
  family: ModelFamily;
};

/** 文本/理解模型注册表（最小集；与 constants 默认 id 对齐） */
export const TEXT_MODEL_REGISTRY: readonly TextModelRegistryEntry[] = [
  { registryId: DEFAULT_MODEL_TEXT, label: "Gemini 3 Flash", family: "gemini" },
  { registryId: "gemini-3-pro-preview", label: "Gemini 3 Pro", family: "gemini" },
  { registryId: "gpt-4o-mini", label: "GPT-4o Mini", family: "openai" },
  { registryId: "gpt-4o", label: "GPT-4o", family: "openai" },
] as const;

export const DEFAULT_TEXT_MODEL_REGISTRY_ID = DEFAULT_MODEL_TEXT;
/** 文本 Pro 档 registryId（勿与生图 DEFAULT_MODEL_PRO 混用） */
export const DEFAULT_PRO_TEXT_REGISTRY_ID = "gemini-3-pro-preview";

export function textModelFamily(registryId: string): ModelFamily {
  const id = (registryId || "").trim().toLowerCase();
  if (id.startsWith("gpt-") || id.startsWith("o1") || id.startsWith("o3") || id.startsWith("o4")) {
    return "openai";
  }
  return "gemini";
}

export function coerceTextModelRegistryId(raw?: string | null): string {
  const s = (raw || "").trim();
  if (!s) return DEFAULT_TEXT_MODEL_REGISTRY_ID;
  const hit = TEXT_MODEL_REGISTRY.find((e) => e.registryId === s);
  if (hit) return hit.registryId;
  return s;
}

export function labelForTextModelRegistryId(registryId: string): string {
  const id = (registryId || "").trim();
  const hit = TEXT_MODEL_REGISTRY.find((e) => e.registryId === id);
  return hit?.label ?? id;
}
