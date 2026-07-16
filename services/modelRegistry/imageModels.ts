/**
 * 对话/工作流生图模型：单一数据源，供 `types.ts` re-export。
 * 新增/下架模型只改本文件；`providerRoute` 决定调用 Gemini 还是 OpenAI，与设置页全局供应商解耦。
 */

import { isRegisteredJimengImageModelId } from "./jimengImageRegistry";

export type ImageModelProviderRoute = "gemini" | "openai";

export const DIALOG_IMAGE_REGISTRY = [
  {
    registryId: "gemini-2.5-flash-image",
    label: "Gemini 2.5 Flash Image",
    maxReferenceImages: 10,
    providerRoute: "gemini" as const,
  },
  {
    registryId: "gemini-3.1-flash-image",
    label: "Gemini 3.1 Flash Image",
    maxReferenceImages: 10,
    providerRoute: "gemini" as const,
  },
  {
    registryId: "gemini-3-pro-image",
    label: "Gemini 3 Pro Image",
    maxReferenceImages: 10,
    providerRoute: "gemini" as const,
  },
  {
    registryId: "gemini-3.1-flash-image-preview",
    label: "Gemini 3.1 Flash Image (Preview)",
    maxReferenceImages: 10,
    providerRoute: "gemini" as const,
  },
  {
    registryId: "gemini-3-pro-image-preview",
    label: "Gemini 3 Pro Image (Preview)",
    maxReferenceImages: 10,
    providerRoute: "gemini" as const,
  },
  {
    registryId: "gpt-image-1.5",
    label: "GPT Image 1.5",
    maxReferenceImages: 16,
    providerRoute: "openai" as const,
  },
  {
    registryId: "gpt-image-2",
    label: "GPT Image 2",
    maxReferenceImages: 16,
    providerRoute: "openai" as const,
  },
] as const;

export type DialogImageModelRegistryId = (typeof DIALOG_IMAGE_REGISTRY)[number]["registryId"];

/** 默认生图 registryId */
export const DEFAULT_IMAGE_MODEL_REGISTRY_ID: DialogImageModelRegistryId = "gemini-3.1-flash-image";

/** 可选生图模型（展示名 -> registryId） */
export const DIALOG_IMAGE_MODELS = DIALOG_IMAGE_REGISTRY.map((e) => ({
  id: e.registryId,
  label: e.label,
})) as readonly { readonly id: string; readonly label: string }[];

/** @deprecated 仅用于旧 preset / 任务字段 `imageGear` 迁移 */
export const LEGACY_IMAGE_GEAR_TO_REGISTRY: Record<string, DialogImageModelRegistryId> = {
  fast: "gemini-2.5-flash-image",
  standard: "gemini-3.1-flash-image",
  pro: "gemini-3-pro-image",
};

/** @deprecated 旧档位 id；新代码请用 registryId */
export type DialogImageGear = keyof typeof LEGACY_IMAGE_GEAR_TO_REGISTRY;

/** @deprecated 与注册表 registryId 同义 */
export type DialogImageGearModelId = DialogImageModelRegistryId;

/** @deprecated 请用 `DIALOG_IMAGE_REGISTRY` + `registryId` */
export const DIALOG_IMAGE_GEARS = [
  { id: "fast" as const, label: "Gemini 2.5 Flash Image", modelId: "gemini-2.5-flash-image" as const },
  {
    id: "standard" as const,
    label: "Gemini 3.1 Flash Image",
    modelId: "gemini-3.1-flash-image" as const,
  },
  { id: "pro" as const, label: "Gemini 3 Pro Image", modelId: "gemini-3-pro-image" as const },
] as const;

const REGISTERED_IMAGE_IDS = new Set<string>(DIALOG_IMAGE_REGISTRY.map((e) => e.registryId));

const PROVIDER_ROUTE_BY_REGISTRY_ID = new Map<string, ImageModelProviderRoute>(
  DIALOG_IMAGE_REGISTRY.map((e) => [e.registryId, e.providerRoute])
);

export function isRegisteredImageModelId(id: string): boolean {
  return REGISTERED_IMAGE_IDS.has((id || "").trim());
}

/** 注册表 id 或已知旧 id（如 `gpt-image-1`） */
export function isKnownImageModelRegistryInput(raw: string): boolean {
  const s = (raw || "").trim();
  return isRegisteredImageModelId(s) || isRegisteredJimengImageModelId(s) || s in LEGACY_IMAGE_REGISTRY_ALIASES;
}

/** 生图 registryId 绑定的 API 供应商（与设置页全局 `aiProvider` 独立） */
export function imageModelProviderRoute(registryId: string): ImageModelProviderRoute {
  const id = (registryId || "").trim();
  return PROVIDER_ROUTE_BY_REGISTRY_ID.get(id) ?? "gemini";
}

export function labelForImageModelRegistryId(registryId: string): string {
  const id = (registryId || "").trim();
  const hit = DIALOG_IMAGE_REGISTRY.find((e) => e.registryId === id);
  return hit?.label ?? id;
}

/** 快捷输入条等窄位 UI 用的短标签（完整名见 `labelForImageModelRegistryId`） */
const SHORT_IMAGE_MODEL_LABELS: Partial<Record<DialogImageModelRegistryId, string>> = {
  "gemini-2.5-flash-image": "2.5",
  "gemini-3.1-flash-image": "3.1",
  "gemini-3-pro-image": "Pro",
  "gemini-3.1-flash-image-preview": "3.1p",
  "gemini-3-pro-image-preview": "Prop",
  "gpt-image-1.5": "1.5",
  "gpt-image-2": "2",
};

export function shortLabelForImageModelRegistryId(registryId: string): string {
  const id = coerceImageModelRegistryId(registryId);
  return SHORT_IMAGE_MODEL_LABELS[id] ?? labelForImageModelRegistryId(id).slice(0, 4);
}

/** 旧 OpenAI / 已下架 registryId → 当前注册表 id */
const LEGACY_IMAGE_REGISTRY_ALIASES: Record<string, DialogImageModelRegistryId> = {
  "gpt-image-1": "gpt-image-1.5",
  "dall-e-3": "gpt-image-1.5",
  "dall-e-2": "gpt-image-1.5",
  /** 旧 preview id 读入时仍映射到 GA（同名能力，非换模型降级） */
  "gemini-3.1-flash-image-preview": "gemini-3.1-flash-image",
  "gemini-3-pro-image-preview": "gemini-3-pro-image",
};

function isProviderImageModelId(id: string): boolean {
  const s = (id || "").trim();
  if (!s) return false;
  if (/^doubao-seedream-/i.test(s)) return true;
  if (/^jimeng-image-/i.test(s)) return true;
  if (/^gpt-image-/i.test(s)) return true;
  if (/^dall-e-/i.test(s)) return true;
  return false;
}

/** 旧 gear id 或 registryId → 合法 registryId */
export function coerceImageModelRegistryId(raw?: string | null): DialogImageModelRegistryId {
  const s = (raw || "").trim();
  const fromLegacyAlias = LEGACY_IMAGE_REGISTRY_ALIASES[s];
  if (fromLegacyAlias) return fromLegacyAlias;
  if (s && isRegisteredImageModelId(s)) return s as DialogImageModelRegistryId;
  if (isProviderImageModelId(s)) return s as DialogImageModelRegistryId;
  const fromGear = LEGACY_IMAGE_GEAR_TO_REGISTRY[s];
  if (fromGear) return fromGear;
  return DEFAULT_IMAGE_MODEL_REGISTRY_ID;
}

/** @deprecated 请用 `coerceImageModelRegistryId` */
export function migrateImageGearToRegistryId(gear?: string): DialogImageModelRegistryId {
  return coerceImageModelRegistryId(gear);
}

/** @deprecated 请用 `coerceImageModelRegistryId` */
export function resolveDialogImageModelIdForGear(gear: string): DialogImageModelRegistryId {
  return coerceImageModelRegistryId(gear);
}

export function resolveImageModelRegistryId(registryId?: string | null): DialogImageModelRegistryId {
  return coerceImageModelRegistryId(registryId);
}

/**
 * 单次请求内参考图数量上限；未列出的模型回退为 8。
 */
export const DIALOG_IMAGE_MODEL_MAX_REFERENCE_IMAGES: Partial<Record<DialogImageModelRegistryId, number>> =
  Object.fromEntries(DIALOG_IMAGE_REGISTRY.map((e) => [e.registryId, e.maxReferenceImages])) as Partial<
    Record<DialogImageModelRegistryId, number>
  >;

export function maxReferenceImagesForImageModel(registryId?: string | null): number {
  const id = coerceImageModelRegistryId(registryId);
  return DIALOG_IMAGE_MODEL_MAX_REFERENCE_IMAGES[id] ?? 8;
}

/** @deprecated 请用 `maxReferenceImagesForImageModel` */
export function maxReferenceImagesForImageGear(gear?: DialogImageGear): number {
  return maxReferenceImagesForImageModel(coerceImageModelRegistryId(gear));
}
