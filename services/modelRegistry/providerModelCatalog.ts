import { JIMENG_CATALOG } from "../jimeng/catalog";
import { DIALOG_IMAGE_REGISTRY } from "./imageModels";
import { TEXT_MODEL_REGISTRY } from "./textModels";
import type { ProviderCatalogId, ProviderModality } from "./providerCatalog";

export type ProviderModelLifecycle = "active" | "preview" | "manual" | "planned";
export type ProviderModelStatus = "verified" | "testing" | "discovered" | "requires_mapping" | "disabled";

export type ProviderModelCatalogEntry = {
  providerId: ProviderCatalogId;
  providerModelId: string;
  registryId?: string;
  label: string;
  modality: ProviderModality;
  lifecycle: ProviderModelLifecycle;
  status: ProviderModelStatus;
  verified?: boolean;
  requiresEndpointMapping?: boolean;
  docsUrl?: string;
};

function providerModelStatus(row: {
  lifecycle: ProviderModelLifecycle;
  verified?: boolean;
  requiresEndpointMapping?: boolean;
}): ProviderModelStatus {
  if (row.requiresEndpointMapping) return "requires_mapping";
  if (row.verified === true) return "verified";
  if (row.verified === false) return "testing";
  if (row.lifecycle === "active") return "verified";
  if (row.lifecycle === "preview" || row.lifecycle === "manual") return "testing";
  return "discovered";
}

function openAiCatalogRows(providerId: ProviderCatalogId): ProviderModelCatalogEntry[] {
  const textRows = TEXT_MODEL_REGISTRY
    .filter((row) => row.family === "openai")
    .map((row) => ({
      providerId,
      providerModelId: row.registryId,
      registryId: row.registryId,
      label: row.label,
      modality: "text" as const,
      lifecycle: "active" as const,
      requiresEndpointMapping: providerId === "volcengine-ark",
      status: providerId === "volcengine-ark" ? ("requires_mapping" as const) : ("verified" as const),
    }));
  const imageRows = DIALOG_IMAGE_REGISTRY
    .filter((row) => row.providerRoute === "openai")
    .map((row) => ({
      providerId,
      providerModelId: row.registryId,
      registryId: row.registryId,
      label: row.label,
      modality: "image" as const,
      lifecycle: "active" as const,
      requiresEndpointMapping: providerId === "volcengine-ark",
      status: providerId === "volcengine-ark" ? ("requires_mapping" as const) : ("verified" as const),
    }));
  return [...textRows, ...imageRows];
}

function geminiCatalogRows(providerId: ProviderCatalogId): ProviderModelCatalogEntry[] {
  const textRows = TEXT_MODEL_REGISTRY
    .filter((row) => row.family === "gemini")
    .map((row) => ({
      providerId,
      providerModelId: row.registryId,
      registryId: row.registryId,
      label: row.label,
      modality: "text" as const,
      lifecycle: "active" as const,
      status: "verified" as const,
    }));
  const imageRows = DIALOG_IMAGE_REGISTRY
    .filter((row) => row.providerRoute === "gemini")
    .map((row) => ({
      providerId,
      providerModelId: row.registryId,
      registryId: row.registryId,
      label: row.label,
      modality: "image" as const,
      lifecycle: row.registryId.includes("preview") ? ("preview" as const) : ("active" as const),
      status: row.registryId.includes("preview") ? ("testing" as const) : ("verified" as const),
    }));
  return [...textRows, ...imageRows];
}

export const VOLCENGINE_ARK_MODEL_CATALOG: readonly ProviderModelCatalogEntry[] = [
  {
    providerId: "volcengine-ark",
    providerModelId: "doubao-seed-2-0-pro-260215",
    registryId: "doubao-seed-2-0-pro",
    label: "Doubao Seed 2.0 Pro",
    modality: "text",
    lifecycle: "active",
    status: "testing",
    docsUrl: "https://www.volcengine.com/docs/82379/1330310",
  },
  {
    providerId: "volcengine-ark",
    providerModelId: "doubao-seed-2-0-lite-260428",
    registryId: "doubao-seed-2-0-lite",
    label: "Doubao Seed 2.0 Lite",
    modality: "text",
    lifecycle: "active",
    status: "testing",
    docsUrl: "https://www.volcengine.com/docs/82379/1330310",
  },
  {
    providerId: "volcengine-ark",
    providerModelId: "doubao-seed-2-0-mini-260428",
    registryId: "doubao-seed-2-0-mini",
    label: "Doubao Seed 2.0 Mini",
    modality: "text",
    lifecycle: "active",
    status: "testing",
    docsUrl: "https://www.volcengine.com/docs/82379/1330310",
  },
  {
    providerId: "volcengine-ark",
    providerModelId: "doubao-seed-2-0-vision-260215",
    registryId: "doubao-seed-2-0-vision",
    label: "Doubao Seed 2.0 Vision",
    modality: "text",
    lifecycle: "active",
    status: "testing",
    docsUrl: "https://www.volcengine.com/docs/82379/1330310",
  },
  {
    providerId: "volcengine-ark",
    providerModelId: "doubao-seedream-5-0-pro-260628",
    registryId: "doubao-seedream-5-0-pro",
    label: "Seedream 5.0 Pro",
    modality: "image",
    lifecycle: "active",
    status: "testing",
    docsUrl: "https://www.volcengine.com/docs/82379/1330310",
  },
  {
    providerId: "volcengine-ark",
    providerModelId: "doubao-seedream-5-0-260128",
    registryId: "doubao-seedream-5-0",
    label: "Seedream 5.0",
    modality: "image",
    lifecycle: "active",
    status: "testing",
    docsUrl: "https://www.volcengine.com/docs/82379/1330310",
  },
  {
    providerId: "volcengine-ark",
    providerModelId: "doubao-seedream-5-0-lite-260128",
    registryId: "doubao-seedream-5-0-lite",
    label: "Seedream 5.0 Lite",
    modality: "image",
    lifecycle: "active",
    status: "testing",
    docsUrl: "https://www.volcengine.com/docs/82379/1330310",
  },
  {
    providerId: "volcengine-ark",
    providerModelId: "doubao-seedance-2-0-260128",
    registryId: "doubao-seedance-2-0",
    label: "Seedance 2.0",
    modality: "video",
    lifecycle: "active",
    status: "testing",
    docsUrl: "https://www.volcengine.com/docs/82379/1330310",
  },
  {
    providerId: "volcengine-ark",
    providerModelId: "doubao-seedance-2-0-fast-260128",
    registryId: "doubao-seedance-2-0-fast",
    label: "Seedance 2.0 Fast",
    modality: "video",
    lifecycle: "active",
    status: "testing",
    docsUrl: "https://www.volcengine.com/docs/82379/1330310",
  },
  {
    providerId: "volcengine-ark",
    providerModelId: "doubao-seed3d-2-0-260328",
    registryId: "doubao-seed3d-2-0",
    label: "Seed3D 2.0",
    modality: "model3d",
    lifecycle: "active",
    status: "testing",
    docsUrl: "https://www.volcengine.com/docs/82379/1330310",
  },
];

export const PROVIDER_MODEL_CATALOG: readonly ProviderModelCatalogEntry[] = [
  ...openAiCatalogRows("openai-official"),
  ...VOLCENGINE_ARK_MODEL_CATALOG,
  ...openAiCatalogRows("toapis"),
  ...geminiCatalogRows("vertex-site"),
  ...geminiCatalogRows("gemini-aistudio"),
  ...geminiCatalogRows("toapis"),
  ...geminiCatalogRows("vectorengine"),
  ...JIMENG_CATALOG.map((row) => {
    const lifecycle = row.verified ? ("active" as const) : ("manual" as const);
    return {
      providerId: "volcengine-jimeng" as const,
      providerModelId: row.upstreamReqKey,
      registryId: row.registryId,
      label: row.label,
      modality: row.modality === "digital_human" ? ("digital_human" as const) : row.modality,
      lifecycle,
      status: providerModelStatus({ lifecycle, verified: row.verified }),
      verified: row.verified,
      docsUrl: row.docRef,
    };
  }),
  {
    providerId: "tripo",
    providerModelId: "P1-20260311",
    registryId: "tripo-p1",
    label: "Tripo P1",
    modality: "model3d",
    lifecycle: "active",
    status: "verified",
  },
  {
    providerId: "tripo",
    providerModelId: "v3.1-20260211",
    registryId: "tripo-v3.1",
    label: "Tripo 3.1",
    modality: "model3d",
    lifecycle: "active",
    status: "verified",
  },
  {
    providerId: "tripo",
    providerModelId: "v3.0-20250812",
    registryId: "tripo-v3.0",
    label: "Tripo 3.0",
    modality: "model3d",
    lifecycle: "active",
    status: "verified",
  },
  {
    providerId: "tripo",
    providerModelId: "v2.5-20250123",
    registryId: "tripo-v2.5",
    label: "Tripo 2.5",
    modality: "model3d",
    lifecycle: "active",
    status: "verified",
  },
  {
    providerId: "tripo",
    providerModelId: "v2.0-20240919",
    registryId: "tripo-v2.0",
    label: "Tripo 2.0",
    modality: "model3d",
    lifecycle: "active",
    status: "verified",
  },
  {
    providerId: "tencent-hunyuan",
    providerModelId: "hunyuan-to-3d-pro",
    registryId: "tencent-hunyuan-3d-pro",
    label: "混元 3D Pro",
    modality: "model3d",
    lifecycle: "active",
    status: "testing",
  },
  {
    providerId: "tencent-hunyuan",
    providerModelId: "hunyuan-to-3d-rapid",
    registryId: "tencent-hunyuan-3d-rapid",
    label: "混元 3D Rapid",
    modality: "model3d",
    lifecycle: "active",
    status: "testing",
  },
] as const;

export function listProviderModels(providerId?: string): ProviderModelCatalogEntry[] {
  const id = String(providerId || "").trim();
  if (!id) return [...PROVIDER_MODEL_CATALOG];
  return PROVIDER_MODEL_CATALOG.filter((row) => row.providerId === id);
}

export function providerModelCount(providerId: string): number {
  return listProviderModels(providerId).length;
}

export function providerModelCountsByModality(providerId: string): Partial<Record<ProviderModality, number>> {
  const out: Partial<Record<ProviderModality, number>> = {};
  for (const row of listProviderModels(providerId)) {
    out[row.modality] = (out[row.modality] || 0) + 1;
  }
  return out;
}
