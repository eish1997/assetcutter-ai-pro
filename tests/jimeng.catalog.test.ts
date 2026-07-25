import { describe, expect, it } from "vitest";
import {
  getJimengCatalogEntry,
  JIMENG_CATALOG,
  JIMENG_VERIFIED_REGISTRY_IDS,
  listJimengCatalogByModality,
} from "../services/jimeng/catalog";
import { validateJimengSubmitInput } from "../services/jimeng/paramsSchema";
import { isJimengParamsValidationFailure } from "../services/jimeng/types";
import { JIMENG_IMAGE_BINDINGS, JIMENG_IMAGE_CHANNEL } from "../services/modelRegistry/jimengBindings";
import { JIMENG_IMAGE_REGISTRY } from "../services/modelRegistry/jimengImageRegistry";
import { JIMENG_VIDEO_REGISTRY } from "../services/modelRegistry/jimengVideoRegistry";
import { resolveVerifiedJimengReqKey } from "../shared/jimengVerifiedRegistry.js";
import { resolveSupportedJimengReqKey } from "../shared/jimengSupportedRegistry.js";

const EXPECTED_IMAGE_IDS = [
  "jimeng-image-t2i-v40",
  "jimeng-image-t2i-v30",
  "jimeng-image-t2i-v31",
  "jimeng-image-i2i-v30",
  "jimeng-image-t2i-v46",
  "jimeng-image-inpainting",
  "jimeng-image-outpainting",
  "jimeng-image-upscale",
  "jimeng-image-pod-extract",
  "jimeng-image-product-extract",
] as const;

const EXPECTED_VIDEO_IDS = [
  "jimeng-video-ti2v-v30-pro",
  "jimeng-video-t2v-v30-720p",
  "jimeng-video-i2v-first-v30-720p",
  "jimeng-video-i2v-first-tail-v30-720p",
  "jimeng-video-i2v-recamera-v30-720p",
  "jimeng-video-t2v-v30-1080p",
  "jimeng-video-i2v-first-v30-1080p",
  "jimeng-video-i2v-first-tail-v30-1080p",
  "jimeng-video-motion-mimic-v20",
  "jimeng-video-translate-v20",
] as const;

const EXPECTED_VERIFIED = {
  "jimeng-image-t2i-v40": "jimeng_t2i_v40",
  "jimeng-video-ti2v-v30-pro": "jimeng_ti2v_v30_pro",
} as const;

const EXPECTED_SUPPORTED = {
  "jimeng-image-t2i-v40": { reqKey: "jimeng_t2i_v40", modality: "image" },
  "jimeng-image-t2i-v30": { reqKey: "jimeng_t2i_v30", modality: "image" },
  "jimeng-image-t2i-v31": { reqKey: "jimeng_t2i_v31", modality: "image" },
  "jimeng-video-ti2v-v30-pro": { reqKey: "jimeng_ti2v_v30_pro", modality: "video" },
} as const;

describe("jimeng catalog", () => {
  it("contains full §3 table with required fields", () => {
    expect(JIMENG_CATALOG).toHaveLength(20);
    for (const entry of JIMENG_CATALOG) {
      expect(entry.registryId).toMatch(/^jimeng-/);
      expect(entry.label.trim()).not.toBe("");
      expect(["image", "video"]).toContain(entry.modality);
      expect(entry.upstreamReqKey.trim()).not.toBe("");
      expect(entry.docRef).toMatch(/^https:\/\/www\.volcengine\.com\/docs\//);
      expect(typeof entry.verified).toBe("boolean");
      expect(entry.warehouseOnly).toBe(true);
      expect(entry.asyncMode).toBe("submit_poll");
    }
  });

  it("has unique registryId values", () => {
    const ids = JIMENG_CATALOG.map((e) => e.registryId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("marks only Owner-verified SKUs as verified", () => {
    const verified = JIMENG_CATALOG.filter((e) => e.verified).map((e) => e.registryId);
    expect(verified.sort()).toEqual([...JIMENG_VERIFIED_REGISTRY_IDS].sort());
    for (const [registryId, reqKey] of Object.entries(EXPECTED_VERIFIED)) {
      const entry = getJimengCatalogEntry(registryId);
      expect(entry?.verified).toBe(true);
      expect(entry?.upstreamReqKey).toBe(reqKey);
    }
    for (const entry of JIMENG_CATALOG.filter((e) => !e.verified)) {
      expect(entry.upstreamReqKey.trim()).not.toBe("");
    }
  });

  it("partitions §3 modalities", () => {
    expect(listJimengCatalogByModality("image").map((e) => e.registryId)).toEqual([...EXPECTED_IMAGE_IDS]);
    expect(listJimengCatalogByModality("video").map((e) => e.registryId)).toEqual([...EXPECTED_VIDEO_IDS]);
  });

  it("exports getJimengCatalogEntry helper", () => {
    expect(getJimengCatalogEntry("jimeng-image-t2i-v40")?.modality).toBe("image");
    expect(getJimengCatalogEntry("missing-sku")).toBeUndefined();
  });

  it("mirrors image registry from catalog", () => {
    expect(JIMENG_IMAGE_REGISTRY).toHaveLength(EXPECTED_IMAGE_IDS.length);
    expect(JIMENG_IMAGE_REGISTRY.every((r) => r.providerRoute === "volcengine-jimeng")).toBe(true);
    expect(JIMENG_IMAGE_REGISTRY.every((r) => r.warehouseOnly === true)).toBe(true);
  });

  it("mirrors video registry", () => {
    expect(JIMENG_VIDEO_REGISTRY).toHaveLength(EXPECTED_VIDEO_IDS.length);
  });

  it("binds image SKUs to volcengine-jimeng channel", () => {
    expect(JIMENG_IMAGE_BINDINGS).toHaveLength(EXPECTED_IMAGE_IDS.length);
    expect(JIMENG_IMAGE_BINDINGS.every((b) => b.channel === JIMENG_IMAGE_CHANNEL)).toBe(true);
    expect(JIMENG_IMAGE_BINDINGS.every((b) => b.role === "image")).toBe(true);
    expect(JIMENG_IMAGE_BINDINGS.every((b) => b.defaultEnabled === false)).toBe(true);
  });

  it("shared verified registry matches catalog verified SKUs", () => {
    const verifiedEntries = JIMENG_CATALOG.filter((e) => e.verified);
    expect(verifiedEntries).toHaveLength(JIMENG_VERIFIED_REGISTRY_IDS.length);
    for (const entry of verifiedEntries) {
      expect(resolveVerifiedJimengReqKey(entry.registryId)).toEqual({
        reqKey: entry.upstreamReqKey,
        modality: entry.modality,
      });
    }
    for (const entry of JIMENG_CATALOG.filter((e) => !e.verified)) {
      expect(resolveVerifiedJimengReqKey(entry.registryId)).toBeNull();
    }
  });

  it("shared supported registry covers smoke-tested SKUs for gateway execution", () => {
    for (const [registryId, expected] of Object.entries(EXPECTED_SUPPORTED)) {
      expect(resolveSupportedJimengReqKey(registryId)).toEqual(expected);
    }
    for (const entry of JIMENG_CATALOG) {
      if (entry.registryId in EXPECTED_SUPPORTED) continue;
      expect(resolveSupportedJimengReqKey(entry.registryId)).toBeNull();
    }
  });
});

describe("jimeng paramsSchema", () => {
  it("requires prompt for verified t2i SKU", () => {
    const result = validateJimengSubmitInput({ registryId: "jimeng-image-t2i-v40" });
    expect(isJimengParamsValidationFailure(result)).toBe(true);
    if (isJimengParamsValidationFailure(result)) {
      expect(result.errors.some((e) => e.field === "prompt")).toBe(true);
    }
  });

  it("accepts verified t2i with prompt", () => {
    expect(
      validateJimengSubmitInput({
        registryId: "jimeng-image-t2i-v40",
        prompt: "a cat",
      }).ok
    ).toBe(true);
  });

  it("requires reference image for i2i SKU", () => {
    const result = validateJimengSubmitInput({ registryId: "jimeng-image-i2i-v30", prompt: "x" });
    expect(isJimengParamsValidationFailure(result)).toBe(true);
    if (isJimengParamsValidationFailure(result)) {
      expect(result.errors.some((e) => e.field === "referenceImages")).toBe(true);
    }
  });
});
