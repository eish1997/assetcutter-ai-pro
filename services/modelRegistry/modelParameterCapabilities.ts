import { imageSizeDropdownOptionsForRegistryModel } from "../openaiAdapter";
import { SUPPORTED_ASPECT_RATIOS } from "../../types";
import { listModelRoutes } from "./modelRouteCatalog";
import type { ProviderModality } from "./providerCatalog";

export type ModelParameterKey =
  | "prompt"
  | "referenceImages"
  | "aspectRatio"
  | "imageSize"
  | "durationSeconds"
  | "resolution"
  | "motionStrength"
  | "taskType"
  | "modelVersion"
  | "quality"
  | "format"
  | "texture"
  | "pbr"
  | "geometryQuality"
  | "textureQuality"
  | "faceLimit"
  | "negativePrompt";

export type ModelParameterCapability = {
  key: ModelParameterKey;
  label: string;
  kind: "text" | "select" | "number" | "boolean";
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
};

export type ModelParameterCapabilitySet = {
  registryId: string;
  providerId: string | null;
  modality: ProviderModality;
  supported: ModelParameterCapability[];
  hidden: ModelParameterKey[];
};

function normalizeId(value: string | null | undefined): string {
  return String(value || "").trim();
}

function routeProviderForModel(registryId: string): string | null {
  return listModelRoutes(registryId).find((route) => route.gatewayExecutionStatus === "gateway_ready")?.providerId || null;
}

function has(caps: ModelParameterCapability[], key: ModelParameterKey): boolean {
  return caps.some((cap) => cap.key === key);
}

function setFor(
  registryId: string,
  modality: ProviderModality,
  supported: ModelParameterCapability[],
  providerId = routeProviderForModel(registryId)
): ModelParameterCapabilitySet {
  const all: ModelParameterKey[] = [
    "prompt",
    "referenceImages",
    "aspectRatio",
    "imageSize",
    "durationSeconds",
    "resolution",
    "motionStrength",
    "taskType",
    "modelVersion",
    "quality",
    "format",
    "texture",
    "pbr",
    "geometryQuality",
    "textureQuality",
    "faceLimit",
    "negativePrompt",
  ];
  return {
    registryId,
    providerId,
    modality,
    supported,
    hidden: all.filter((key) => !has(supported, key)),
  };
}

export function resolveModelParameterCapabilities(params: {
  registryId?: string | null;
  modality: "image" | "video" | "model3d";
}): ModelParameterCapabilitySet {
  const registryId = normalizeId(params.registryId);
  const providerId = routeProviderForModel(registryId);

  if (params.modality === "image") {
    const imageSizes = imageSizeDropdownOptionsForRegistryModel(registryId).filter((item) => item.value);
    return setFor(registryId, "image", [
      { key: "prompt", label: "Prompt", kind: "text", required: true },
      { key: "referenceImages", label: "Reference images", kind: "text" },
      { key: "aspectRatio", label: "Aspect ratio", kind: "select", options: SUPPORTED_ASPECT_RATIOS.map((r) => ({ value: r.value, label: r.label })) },
      ...(imageSizes.length ? [{ key: "imageSize" as const, label: "Image size", kind: "select" as const, options: imageSizes }] : []),
    ], providerId);
  }

  if (params.modality === "video") {
    if (registryId.startsWith("doubao-seedance-")) {
      return setFor(registryId, "video", [
        { key: "prompt", label: "Prompt", kind: "text", required: true },
        { key: "referenceImages", label: "Reference images", kind: "text" },
        { key: "durationSeconds", label: "Duration", kind: "select", options: ["5", "10"].map((value) => ({ value, label: `${value}s` })) },
        { key: "aspectRatio", label: "Aspect ratio", kind: "select", options: ["16:9", "9:16", "1:1"].map((value) => ({ value, label: value })) },
        { key: "resolution", label: "Resolution", kind: "select", options: ["720p", "1080p"].map((value) => ({ value, label: value })) },
        { key: "motionStrength", label: "Motion strength", kind: "number" },
      ], "volcengine-ark");
    }
    return setFor(registryId, "video", [
      { key: "prompt", label: "Prompt", kind: "text", required: true },
      { key: "referenceImages", label: "Reference images", kind: "text" },
      { key: "durationSeconds", label: "Duration", kind: "select", options: ["5", "10"].map((value) => ({ value, label: `${value}s` })) },
      { key: "aspectRatio", label: "Aspect ratio", kind: "select", options: ["16:9", "9:16", "1:1"].map((value) => ({ value, label: value })) },
    ], providerId);
  }

  if (registryId.startsWith("doubao-seed3d-")) {
    return setFor(registryId, "model3d", [
      { key: "prompt", label: "Prompt", kind: "text", required: true },
      { key: "referenceImages", label: "Reference images", kind: "text" },
      { key: "quality", label: "Quality", kind: "select", options: ["standard", "high"].map((value) => ({ value, label: value })) },
      { key: "format", label: "Format", kind: "select", options: ["glb", "obj", "fbx", "usdz", "zip"].map((value) => ({ value, label: value.toUpperCase() })) },
      { key: "texture", label: "Texture", kind: "boolean" },
    ], "volcengine-ark");
  }

  if (registryId.startsWith("tencent-hunyuan-")) {
    return setFor(registryId, "model3d", [
      { key: "referenceImages", label: "Reference images", kind: "text", required: true },
      { key: "quality", label: "Quality", kind: "select", options: ["pro", "rapid"].map((value) => ({ value, label: value })) },
      { key: "format", label: "Format", kind: "select", options: ["GLB", "OBJ", "STL", "USDZ", "FBX"].map((value) => ({ value, label: value })) },
      { key: "pbr", label: "PBR", kind: "boolean" },
      { key: "faceLimit", label: "Face count", kind: "number" },
    ], "tencent-hunyuan");
  }

  return setFor(registryId, "model3d", [
    { key: "prompt", label: "Prompt", kind: "text" },
    { key: "referenceImages", label: "Reference images", kind: "text" },
    { key: "taskType", label: "Task type", kind: "select", options: ["image_to_model", "multiview_to_model", "text_to_model"].map((value) => ({ value, label: value })) },
    { key: "modelVersion", label: "Model version", kind: "select" },
    { key: "geometryQuality", label: "Geometry quality", kind: "select", options: ["standard", "detailed"].map((value) => ({ value, label: value })) },
    { key: "textureQuality", label: "Texture quality", kind: "select", options: ["standard", "detailed"].map((value) => ({ value, label: value })) },
    { key: "texture", label: "Texture", kind: "boolean" },
    { key: "pbr", label: "PBR", kind: "boolean" },
    { key: "faceLimit", label: "Face limit", kind: "number" },
    { key: "negativePrompt", label: "Negative prompt", kind: "text" },
  ], providerId || "tripo");
}

export function modelSupportsParameter(
  registryId: string | null | undefined,
  modality: "image" | "video" | "model3d",
  key: ModelParameterKey
): boolean {
  return resolveModelParameterCapabilities({ registryId, modality }).supported.some((cap) => cap.key === key);
}
