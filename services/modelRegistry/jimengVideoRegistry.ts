import { listJimengCatalogByModality } from "../jimeng/catalog";
import type { JimengCatalogEntry } from "../jimeng/types";

export type JimengVideoRegistryRow = {
  registryId: string;
  label: string;
  upstreamReqKey: string;
  verified: boolean;
  warehouseOnly: true;
  maxReferenceImages?: number;
};

function toVideoRegistryRow(entry: JimengCatalogEntry): JimengVideoRegistryRow {
  return {
    registryId: entry.registryId,
    label: entry.label,
    upstreamReqKey: entry.upstreamReqKey,
    verified: entry.verified,
    warehouseOnly: true,
    ...(entry.maxReferenceImages != null ? { maxReferenceImages: entry.maxReferenceImages } : {}),
  };
}

/** 视频 SKU 独立 registry（不经 pickBinding / ModelResolveRole） */
export const JIMENG_VIDEO_REGISTRY: readonly JimengVideoRegistryRow[] = listJimengCatalogByModality("video").map(
  toVideoRegistryRow
);

export type JimengVideoRegistryId = (typeof JIMENG_VIDEO_REGISTRY)[number]["registryId"];

const REGISTERED_JIMENG_VIDEO_IDS = new Set<string>(JIMENG_VIDEO_REGISTRY.map((e) => e.registryId));

export function isRegisteredJimengVideoModelId(id: string): boolean {
  return REGISTERED_JIMENG_VIDEO_IDS.has((id || "").trim());
}

export function labelForJimengVideoRegistryId(registryId: string): string {
  const id = (registryId || "").trim();
  return JIMENG_VIDEO_REGISTRY.find((e) => e.registryId === id)?.label ?? id;
}

export function jimengVideoCatalogEntry(registryId: string): JimengCatalogEntry | undefined {
  return listJimengCatalogByModality("video").find((e) => e.registryId === (registryId || "").trim());
}
