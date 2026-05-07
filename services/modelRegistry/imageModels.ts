/**
 * 对话生图相关模型：单一数据源，供 `types.ts` re-export。
 * 新增/下架模型只改本文件。
 */

export const DIALOG_IMAGE_REGISTRY = [
  {
    registryId: "gemini-2.5-flash-image",
    label: "Gemini 2.5 Flash Image",
    maxReferenceImages: 10,
  },
  {
    registryId: "gemini-3.1-flash-image-preview",
    label: "Gemini 3.1 Flash Image",
    maxReferenceImages: 10,
  },
  {
    registryId: "gemini-3-pro-image-preview",
    label: "Gemini 3 Pro Image",
    maxReferenceImages: 10,
  },
] as const;

/** 可选生图模型（展示名 -> registryId） */
export const DIALOG_IMAGE_MODELS = DIALOG_IMAGE_REGISTRY.map((e) => ({
  id: e.registryId,
  label: e.label,
})) as readonly { readonly id: string; readonly label: string }[];

/** 生图挡位（快速 / 标准 / Pro） */
export const DIALOG_IMAGE_GEARS = [
  { id: "fast" as const, label: "快速", modelId: "gemini-2.5-flash-image" as const },
  { id: "standard" as const, label: "标准", modelId: "gemini-3.1-flash-image-preview" as const },
  { id: "pro" as const, label: "Pro", modelId: "gemini-3-pro-image-preview" as const },
] as const;

export type DialogImageGear = (typeof DIALOG_IMAGE_GEARS)[number]["id"];

export type DialogImageGearModelId = (typeof DIALOG_IMAGE_GEARS)[number]["modelId"];

/** 快捷栏档位 → Gemini 生图 registryId（与 `DIALOG_IMAGE_GEARS` 一致） */
export function resolveDialogImageModelIdForGear(gear: string): DialogImageGearModelId {
  const g = (DIALOG_IMAGE_GEARS.some((x) => x.id === gear) ? gear : "standard") as DialogImageGear;
  return DIALOG_IMAGE_GEARS.find((x) => x.id === g)!.modelId;
}

/**
 * 单次请求内参考图数量上限；未列出的模型回退为 8（与 types 原注释一致）。
 */
export const DIALOG_IMAGE_MODEL_MAX_REFERENCE_IMAGES: Partial<Record<DialogImageGearModelId, number>> =
  Object.fromEntries(DIALOG_IMAGE_REGISTRY.map((e) => [e.registryId, e.maxReferenceImages])) as Partial<
    Record<DialogImageGearModelId, number>
  >;

export function maxReferenceImagesForImageGear(gear?: DialogImageGear): number {
  const id = (gear && DIALOG_IMAGE_GEARS.some((g) => g.id === gear) ? gear : "standard") as DialogImageGear;
  const modelId = DIALOG_IMAGE_GEARS.find((g) => g.id === id)!.modelId;
  return DIALOG_IMAGE_MODEL_MAX_REFERENCE_IMAGES[modelId] ?? 8;
}

const REGISTERED_IMAGE_IDS = new Set<string>(DIALOG_IMAGE_REGISTRY.map((e) => e.registryId));

export function isRegisteredImageModelId(id: string): boolean {
  return REGISTERED_IMAGE_IDS.has((id || "").trim());
}
