import { JIMENG_CATALOG } from "../jimeng/catalog";
import { DIALOG_IMAGE_REGISTRY } from "./imageModels";
import { TEXT_MODEL_REGISTRY } from "./textModels";
import { VOLCENGINE_ARK_MODEL_CATALOG, listProviderModels } from "./providerModelCatalog";
import type { ProviderModality } from "./providerCatalog";

export type CanonicalModelStatus = "draft" | "published" | "deprecated" | "disabled";

export type CanonicalModelCatalogEntry = {
  canonicalModelId: string;
  label: string;
  modality: ProviderModality;
  category: string;
  visibleInWorkspace: boolean;
  defaultForModality?: boolean;
  supportedWorkflows: readonly string[];
  status: CanonicalModelStatus;
  sourceRegistryId?: string;
};

const TEXT_CANONICAL_MODELS: CanonicalModelCatalogEntry[] = TEXT_MODEL_REGISTRY.map((row, index) => ({
  canonicalModelId: row.registryId,
  label: row.label,
  modality: "text",
  category: "text_generation",
  visibleInWorkspace: true,
  defaultForModality: index === 0,
  supportedWorkflows: ["chat", "workflow"],
  status: "published",
  sourceRegistryId: row.registryId,
}));

const IMAGE_CANONICAL_MODELS: CanonicalModelCatalogEntry[] = DIALOG_IMAGE_REGISTRY.map((row, index) => ({
  canonicalModelId: row.registryId,
  label: row.label,
  modality: "image",
  category: "image_generation",
  visibleInWorkspace: true,
  defaultForModality: index === 0,
  supportedWorkflows: ["dialog", "workflow", "asset_set"],
  status: "published",
  sourceRegistryId: row.registryId,
}));

const JIMENG_CANONICAL_MODELS: CanonicalModelCatalogEntry[] = JIMENG_CATALOG.map((row) => ({
  canonicalModelId: row.registryId,
  label: row.label,
  modality: row.modality === "digital_human" ? "digital_human" : row.modality,
  category:
    row.modality === "video" ? "video_generation" : row.modality === "digital_human" ? "digital_human" : "image_generation",
  visibleInWorkspace: row.verified === true,
  supportedWorkflows: row.modality === "video" ? ["workflow"] : ["warehouse", "workflow"],
  status: row.verified ? "published" : "draft",
  sourceRegistryId: row.registryId,
}));

function arkCategory(modality: ProviderModality): string {
  if (modality === "text") return "text_generation";
  if (modality === "image") return "image_generation";
  if (modality === "video") return "video_generation";
  if (modality === "model3d") return "model3d_generation";
  return `${modality}_generation`;
}

function arkWorkflows(modality: ProviderModality): string[] {
  if (modality === "text") return ["chat", "workflow"];
  if (modality === "image") return ["workflow", "asset_set"];
  if (modality === "video") return ["workflow"];
  if (modality === "model3d") return ["workflow", "asset_set"];
  return ["workflow"];
}

const ARK_CANONICAL_MODELS: CanonicalModelCatalogEntry[] = VOLCENGINE_ARK_MODEL_CATALOG.map((row) => ({
  canonicalModelId: row.registryId || row.providerModelId,
  label: row.label,
  modality: row.modality,
  category: arkCategory(row.modality),
  visibleInWorkspace: true,
  supportedWorkflows: arkWorkflows(row.modality),
  status: "draft",
  sourceRegistryId: row.registryId || row.providerModelId,
}));

const TRIPO_CANONICAL_MODELS: CanonicalModelCatalogEntry[] = listProviderModels("tripo")
  .filter((row) => row.modality === "model3d")
  .map((row) => ({
    canonicalModelId: row.registryId || row.providerModelId,
    label: row.label,
    modality: "model3d" as const,
    category: "model3d_generation",
    visibleInWorkspace: row.status !== "disabled",
    defaultForModality: row.registryId === "tripo-p1",
    supportedWorkflows: ["workflow", "asset_set"],
    status: row.status === "disabled" ? ("disabled" as const) : ("published" as const),
    sourceRegistryId: row.registryId || row.providerModelId,
  }));

const MODEL3D_CANONICAL_MODELS: CanonicalModelCatalogEntry[] = [
  ...TRIPO_CANONICAL_MODELS,
  {
    canonicalModelId: "tencent-hunyuan-3d-pro",
    label: "混元 3D Pro",
    modality: "model3d",
    category: "model3d_generation",
    visibleInWorkspace: true,
    supportedWorkflows: ["workflow", "asset_set"],
    status: "published",
    sourceRegistryId: "tencent-hunyuan-3d-pro",
  },
  {
    canonicalModelId: "tencent-hunyuan-3d-rapid",
    label: "混元 3D Rapid",
    modality: "model3d",
    category: "model3d_generation",
    visibleInWorkspace: true,
    supportedWorkflows: ["workflow", "asset_set"],
    status: "published",
    sourceRegistryId: "tencent-hunyuan-3d-rapid",
  },
];

function uniqueByCanonicalId(rows: readonly CanonicalModelCatalogEntry[]): CanonicalModelCatalogEntry[] {
  const out: CanonicalModelCatalogEntry[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.canonicalModelId)) continue;
    seen.add(row.canonicalModelId);
    out.push(row);
  }
  return out;
}

export const CANONICAL_MODEL_CATALOG: readonly CanonicalModelCatalogEntry[] = uniqueByCanonicalId([
  ...TEXT_CANONICAL_MODELS,
  ...IMAGE_CANONICAL_MODELS,
  ...ARK_CANONICAL_MODELS,
  ...JIMENG_CANONICAL_MODELS,
  ...MODEL3D_CANONICAL_MODELS,
]);

export function listCanonicalModels(modality?: ProviderModality): CanonicalModelCatalogEntry[] {
  if (!modality) return [...CANONICAL_MODEL_CATALOG];
  return CANONICAL_MODEL_CATALOG.filter((row) => row.modality === modality);
}

export function listPublishedCanonicalModels(modality?: ProviderModality): CanonicalModelCatalogEntry[] {
  return listCanonicalModels(modality).filter((row) => row.status === "published" && row.visibleInWorkspace);
}

export function getCanonicalModel(canonicalModelId: string): CanonicalModelCatalogEntry | undefined {
  const id = String(canonicalModelId || "").trim();
  return CANONICAL_MODEL_CATALOG.find((row) => row.canonicalModelId === id);
}

export function resolveCanonicalModelId(input: string): string | undefined {
  const id = String(input || "").trim();
  if (!id) return undefined;
  const row = CANONICAL_MODEL_CATALOG.find(
    (item) => item.canonicalModelId === id || item.sourceRegistryId === id
  );
  return row?.canonicalModelId;
}
