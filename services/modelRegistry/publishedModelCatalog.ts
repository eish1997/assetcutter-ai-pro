import { listCanonicalModels, listPublishedCanonicalModels, type CanonicalModelCatalogEntry } from "./canonicalModelCatalog";
import { listModelRoutes } from "./modelRouteCatalog";
import type { ProviderModality } from "./providerCatalog";
import type { ModelOpsConfig } from "./opsTypes";

export type PublishedWorkspaceModelRow = {
  canonicalModelId: string;
  registryId: string;
  label: string;
  modality: Extract<ProviderModality, "text" | "image" | "video" | "model3d" | "music">;
  defaultForModality?: boolean;
  gatewayReady: boolean;
};

function uniqueByRegistryId(rows: readonly PublishedWorkspaceModelRow[]): PublishedWorkspaceModelRow[] {
  const out: PublishedWorkspaceModelRow[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.registryId)) continue;
    seen.add(row.registryId);
    out.push(row);
  }
  return out;
}

type PublishedModelOps = Pick<ModelOpsConfig, "publishedCanonicalModelAllowlist">;

function filterByPublishedAllowlist<T extends { canonicalModelId: string }>(
  rows: readonly T[],
  ops?: PublishedModelOps
): T[] {
  const allow = ops?.publishedCanonicalModelAllowlist;
  if (allow == null || allow.length === 0) return [...rows];
  const allowSet = new Set(allow);
  return rows.filter((row) => allowSet.has(row.canonicalModelId));
}

function workspaceCanonicalModels(
  modality: ProviderModality,
  ops?: PublishedModelOps
): CanonicalModelCatalogEntry[] {
  const allow = ops?.publishedCanonicalModelAllowlist;
  if (allow == null || allow.length === 0) return listPublishedCanonicalModels(modality);
  return listCanonicalModels(modality).filter((row) => row.visibleInWorkspace && row.status !== "disabled");
}

export function listPublishedWorkspaceImageModels(ops?: PublishedModelOps): PublishedWorkspaceModelRow[] {
  return uniqueByRegistryId(
    filterByPublishedAllowlist(workspaceCanonicalModels("image", ops), ops)
      .filter((row) => row.supportedWorkflows.includes("dialog") || row.supportedWorkflows.includes("workflow"))
      .map((row) => ({
        canonicalModelId: row.canonicalModelId,
        registryId: row.sourceRegistryId || row.canonicalModelId,
        label: row.label,
        modality: "image" as const,
        defaultForModality: row.defaultForModality,
        gatewayReady: gatewayReadyForCanonicalModel(row.canonicalModelId),
      }))
  );
}

export function listPublishedWorkspaceTextModels(ops?: PublishedModelOps): PublishedWorkspaceModelRow[] {
  return uniqueByRegistryId(
    filterByPublishedAllowlist(workspaceCanonicalModels("text", ops), ops)
      .filter((row) => row.supportedWorkflows.includes("chat") || row.supportedWorkflows.includes("workflow"))
      .map((row) => ({
        canonicalModelId: row.canonicalModelId,
        registryId: row.sourceRegistryId || row.canonicalModelId,
        label: row.label,
        modality: "text" as const,
        defaultForModality: row.defaultForModality,
        gatewayReady: gatewayReadyForCanonicalModel(row.canonicalModelId),
      }))
  );
}

function gatewayReadyForCanonicalModel(canonicalModelId: string): boolean {
  return listModelRoutes(canonicalModelId).some((route) => route.gatewayExecutionStatus === "ready");
}

function listPublishedWorkspaceCapabilityModels(
  modality: Extract<ProviderModality, "video" | "model3d" | "music">,
  ops?: PublishedModelOps
): PublishedWorkspaceModelRow[] {
  return uniqueByRegistryId(
    filterByPublishedAllowlist(workspaceCanonicalModels(modality, ops), ops)
      .filter((row) => row.supportedWorkflows.includes("workflow"))
      .map((row) => ({
        canonicalModelId: row.canonicalModelId,
        registryId: row.sourceRegistryId || row.canonicalModelId,
        label: row.label,
        modality,
        defaultForModality: row.defaultForModality,
        gatewayReady: gatewayReadyForCanonicalModel(row.canonicalModelId),
      }))
  );
}

export function listPublishedWorkspaceVideoModels(ops?: PublishedModelOps): PublishedWorkspaceModelRow[] {
  return listPublishedWorkspaceCapabilityModels("video", ops);
}

export function listPublishedWorkspaceModel3dModels(ops?: PublishedModelOps): PublishedWorkspaceModelRow[] {
  return listPublishedWorkspaceCapabilityModels("model3d", ops);
}

export function listPublishedWorkspaceMusicModels(ops?: PublishedModelOps): PublishedWorkspaceModelRow[] {
  return listPublishedWorkspaceCapabilityModels("music", ops);
}

export function listPublishedWorkspaceModels(
  modality: "text" | "image" | "video" | "model3d" | "music",
  ops?: PublishedModelOps
): PublishedWorkspaceModelRow[] {
  if (modality === "text") return listPublishedWorkspaceTextModels(ops);
  if (modality === "image") return listPublishedWorkspaceImageModels(ops);
  if (modality === "video") return listPublishedWorkspaceVideoModels(ops);
  if (modality === "model3d") return listPublishedWorkspaceModel3dModels(ops);
  return listPublishedWorkspaceMusicModels(ops);
}
