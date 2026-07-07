import { listJimengCatalogByModality } from "../jimeng/catalog";
import type { JimengCatalogEntry } from "../jimeng/types";

export type JimengDigitalHumanRegistryRow = {
  registryId: string;
  label: string;
  upstreamReqKey: string;
  verified: boolean;
  warehouseOnly: true;
  asyncMode: "omnihuman_v1";
};

function toDigitalHumanRegistryRow(entry: JimengCatalogEntry): JimengDigitalHumanRegistryRow {
  return {
    registryId: entry.registryId,
    label: entry.label,
    upstreamReqKey: entry.upstreamReqKey,
    verified: entry.verified,
    warehouseOnly: true,
    asyncMode: "omnihuman_v1",
  };
}

/** 数字人 SKU 独立 registry（不经 pickBinding / ModelResolveRole） */
export const JIMENG_DIGITAL_HUMAN_REGISTRY: readonly JimengDigitalHumanRegistryRow[] =
  listJimengCatalogByModality("digital_human").map(toDigitalHumanRegistryRow);

export type JimengDigitalHumanRegistryId = (typeof JIMENG_DIGITAL_HUMAN_REGISTRY)[number]["registryId"];

const REGISTERED_JIMENG_DH_IDS = new Set<string>(JIMENG_DIGITAL_HUMAN_REGISTRY.map((e) => e.registryId));

export function isRegisteredJimengDigitalHumanModelId(id: string): boolean {
  return REGISTERED_JIMENG_DH_IDS.has((id || "").trim());
}

export function labelForJimengDigitalHumanRegistryId(registryId: string): string {
  const id = (registryId || "").trim();
  return JIMENG_DIGITAL_HUMAN_REGISTRY.find((e) => e.registryId === id)?.label ?? id;
}

export function jimengDigitalHumanCatalogEntry(registryId: string): JimengCatalogEntry | undefined {
  return listJimengCatalogByModality("digital_human").find((e) => e.registryId === (registryId || "").trim());
}
