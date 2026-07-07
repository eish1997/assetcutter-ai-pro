import { listJimengCatalogByModality } from "../jimeng/catalog";
import type { JimengCatalogEntry } from "../jimeng/types";
import type { ChannelId, ModelResolveRole, ProviderBinding } from "./types";

/** 图类 jimeng SKU 在 imageModels 扩展表中的 providerRoute */
export type JimengImageProviderRoute = "volcengine-jimeng";

export type JimengImageRegistryRow = {
  registryId: string;
  label: string;
  maxReferenceImages?: number;
  providerRoute: JimengImageProviderRoute;
  warehouseOnly: true;
};

function toImageRegistryRow(entry: JimengCatalogEntry): JimengImageRegistryRow {
  return {
    registryId: entry.registryId,
    label: entry.label,
    ...(entry.maxReferenceImages != null ? { maxReferenceImages: entry.maxReferenceImages } : {}),
    providerRoute: "volcengine-jimeng",
    warehouseOnly: true,
  };
}

/** 图类 SKU mirror（warehouseOnly，不经运营 allowlist） */
export const JIMENG_IMAGE_REGISTRY: readonly JimengImageRegistryRow[] = listJimengCatalogByModality(
  "image"
).map(toImageRegistryRow);

export type JimengImageRegistryId = (typeof JIMENG_IMAGE_REGISTRY)[number]["registryId"];

const REGISTERED_JIMENG_IMAGE_IDS = new Set<string>(JIMENG_IMAGE_REGISTRY.map((e) => e.registryId));

export function isRegisteredJimengImageModelId(id: string): boolean {
  return REGISTERED_JIMENG_IMAGE_IDS.has((id || "").trim());
}

export function labelForJimengImageRegistryId(registryId: string): string {
  const id = (registryId || "").trim();
  return JIMENG_IMAGE_REGISTRY.find((e) => e.registryId === id)?.label ?? id;
}

export function maxReferenceImagesForJimengImage(registryId: string): number {
  const id = (registryId || "").trim();
  const hit = JIMENG_IMAGE_REGISTRY.find((e) => e.registryId === id);
  return hit?.maxReferenceImages ?? 8;
}

export function jimengImageCatalogEntry(registryId: string): JimengCatalogEntry | undefined {
  return listJimengCatalogByModality("image").find((e) => e.registryId === (registryId || "").trim());
}
