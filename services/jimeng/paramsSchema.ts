import { getJimengCatalogEntry } from "./catalog";
import {
  isJimengParamsValidationFailure,
  type JimengCatalogEntry,
  type JimengOmniHumanInput,
  type JimengParamsValidationResult,
  type JimengSubmitInput,
} from "./types";

function fail(field: string, message: string): JimengParamsValidationResult {
  return { ok: false, errors: [{ field, message }] };
}

function mergeResults(
  ...results: JimengParamsValidationResult[]
): JimengParamsValidationResult {
  const errors = results.flatMap((r) => {
    if (!isJimengParamsValidationFailure(r)) return [];
    return r.errors;
  });
  if (errors.length === 0) {
    return { ok: true };
  }
  return { ok: false, errors };
}

function hasNonEmptyText(value: string | undefined): boolean {
  return Boolean((value || "").trim());
}

function countReferenceImages(input: JimengSubmitInput): number {
  return (input.referenceImages ?? []).filter((u) => (u || "").trim()).length;
}

function registryNeedsPrompt(entry: JimengCatalogEntry): boolean {
  const id = entry.registryId;
  if (entry.modality === "digital_human") return false;
  if (id.includes("-i2i-") || id.includes("-inpainting") || id.includes("-outpainting")) {
    return false;
  }
  if (id.includes("-upscale") || id.includes("-extract") || id.includes("-pod-")) {
    return false;
  }
  if (id.startsWith("jimeng-video-i2v-") && !id.includes("t2v")) {
    return false;
  }
  if (id.includes("motion-mimic") || id.includes("translate")) {
    return false;
  }
  return true;
}

function registryNeedsReferenceImages(entry: JimengCatalogEntry): boolean {
  const id = entry.registryId;
  if (entry.maxReferenceImages != null && entry.maxReferenceImages > 0) return true;
  return (
    id.includes("-i2i-") ||
    id.includes("-inpainting") ||
    id.includes("-outpainting") ||
    id.includes("-upscale") ||
    id.includes("-extract") ||
    id.includes("-pod-") ||
    (id.startsWith("jimeng-video-i2v-") && !id.includes("t2v")) ||
    id.includes("motion-mimic") ||
    id.includes("translate")
  );
}

function minReferenceImages(entry: JimengCatalogEntry): number {
  if (entry.registryId.includes("first-tail")) return 2;
  return registryNeedsReferenceImages(entry) ? 1 : 0;
}

function validateDimensions(input: JimengSubmitInput): JimengParamsValidationResult {
  const { width, height } = input;
  if (width == null && height == null) return { ok: true };
  if (width != null && (!Number.isFinite(width) || width <= 0)) {
    return fail("width", "width 须为正数");
  }
  if (height != null && (!Number.isFinite(height) || height <= 0)) {
    return fail("height", "height 须为正数");
  }
  return { ok: true };
}

function validateReferenceImages(
  entry: JimengCatalogEntry,
  input: JimengSubmitInput
): JimengParamsValidationResult {
  const count = countReferenceImages(input);
  const min = minReferenceImages(entry);
  const max = entry.maxReferenceImages ?? (min > 0 ? min : undefined);

  if (min > 0 && count < min) {
    return fail("referenceImages", `至少需要 ${min} 张参考图`);
  }
  if (max != null && count > max) {
    return fail("referenceImages", `最多 ${max} 张参考图`);
  }
  return { ok: true };
}

/** SKU 参数校验（submit_poll 路径） */
export function validateJimengSubmitInput(input: JimengSubmitInput): JimengParamsValidationResult {
  const registryId = (input.registryId || "").trim();
  if (!registryId) return fail("registryId", "缺少 registryId");

  const entry = getJimengCatalogEntry(registryId);
  if (!entry) return fail("registryId", `未知即梦 SKU：${registryId}`);
  if (entry.asyncMode === "omnihuman_v1") {
    return fail("registryId", "数字人 SKU 请使用 validateJimengOmniHumanInput");
  }

  const checks: JimengParamsValidationResult[] = [validateDimensions(input), validateReferenceImages(entry, input)];

  if (registryNeedsPrompt(entry) && !hasNonEmptyText(input.prompt)) {
    checks.push(fail("prompt", "该 SKU 需要 prompt"));
  }

  return mergeResults(...checks);
}

/** 数字人 OmniHuman 参数校验 */
export function validateJimengOmniHumanInput(input: JimengOmniHumanInput): JimengParamsValidationResult {
  const entry = getJimengCatalogEntry(input.registryId);
  if (!entry) return fail("registryId", `未知即梦 SKU：${input.registryId}`);
  if (entry.asyncMode !== "omnihuman_v1") {
    return fail("registryId", "该 SKU 不支持 OmniHuman 输入");
  }

  if (!hasNonEmptyText(input.portraitImage)) {
    return fail("portraitImage", "需要 portraitImage");
  }

  const hasAudio = hasNonEmptyText(input.driveAudioUrl);
  const hasVideo = hasNonEmptyText(input.driveVideoUrl);
  if (!hasAudio && !hasVideo) {
    return fail("driveAudioUrl", "需要 driveAudioUrl 或 driveVideoUrl 之一");
  }

  return { ok: true };
}

/** 按 registryId 自动分流 submit / omnihuman 校验 */
export function validateJimengParams(
  input: JimengSubmitInput | JimengOmniHumanInput
): JimengParamsValidationResult {
  const entry = getJimengCatalogEntry(input.registryId);
  if (!entry) return fail("registryId", `未知即梦 SKU：${input.registryId}`);
  if (entry.asyncMode === "omnihuman_v1") {
    return validateJimengOmniHumanInput(input as JimengOmniHumanInput);
  }
  return validateJimengSubmitInput(input as JimengSubmitInput);
}
