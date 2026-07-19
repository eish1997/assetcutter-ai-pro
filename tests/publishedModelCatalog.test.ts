import { describe, expect, it } from "vitest";
import {
  listPublishedWorkspaceImageModels,
  listPublishedWorkspaceModel3dModels,
  listPublishedWorkspaceTextModels,
  listPublishedWorkspaceVideoModels,
} from "../services/modelRegistry";

describe("published workspace model catalog", () => {
  it("lists published text models from canonical catalog", () => {
    const rows = listPublishedWorkspaceTextModels();

    expect(rows.map((row) => row.registryId)).toEqual(
      expect.arrayContaining(["gemini-3-flash-preview", "gpt-4o-mini"])
    );
    expect(rows.every((row) => row.modality === "text")).toBe(true);
  });

  it("filters published text models by canonical allowlist", () => {
    const rows = listPublishedWorkspaceTextModels({
      publishedCanonicalModelAllowlist: ["gpt-4o-mini"],
    });

    expect(rows.map((row) => row.registryId)).toEqual(["gpt-4o-mini"]);
  });

  it("keeps image catalog rows queryable with gateway readiness", () => {
    const rows = listPublishedWorkspaceImageModels();

    expect(rows.map((row) => row.registryId)).toContain("gpt-image-2");
    expect(rows.map((row) => row.registryId)).toContain("jimeng-image-t2i-v40");
    expect(rows.find((row) => row.registryId === "gpt-image-2")?.gatewayReady).toBe(true);
    expect(rows.find((row) => row.registryId === "jimeng-image-t2i-v40")?.gatewayReady).toBe(true);
    expect(rows.every((row) => row.modality === "image")).toBe(true);
  });

  it("filters published image models by canonical allowlist", () => {
    const rows = listPublishedWorkspaceImageModels({
      publishedCanonicalModelAllowlist: ["gemini-2.5-flash-image", "gpt-4o-mini"],
    });

    expect(rows.map((row) => row.registryId)).toEqual(["gemini-2.5-flash-image"]);
  });

  it("uses the admin allowlist as publication source for draft text and image models", () => {
    const textRows = listPublishedWorkspaceTextModels({
      publishedCanonicalModelAllowlist: ["doubao-seed-2-0-pro", "gpt-4o-mini"],
    });
    const imageRows = listPublishedWorkspaceImageModels({
      publishedCanonicalModelAllowlist: ["doubao-seedream-5-0", "gpt-image-2"],
    });

    expect(textRows.map((row) => row.registryId)).toEqual(["gpt-4o-mini", "doubao-seed-2-0-pro"]);
    expect(textRows.find((row) => row.registryId === "gpt-4o-mini")?.gatewayReady).toBe(true);
    expect(textRows.find((row) => row.registryId === "doubao-seed-2-0-pro")?.gatewayReady).toBe(true);
    expect(imageRows.map((row) => row.registryId)).toEqual(["gpt-image-2", "doubao-seedream-5-0"]);
    expect(imageRows.find((row) => row.registryId === "gpt-image-2")?.gatewayReady).toBe(true);
    expect(imageRows.find((row) => row.registryId === "doubao-seedream-5-0")?.gatewayReady).toBe(true);
  });

  it("uses the admin allowlist as publication source for draft video and 3D models", () => {
    const videoRows = listPublishedWorkspaceVideoModels({
      publishedCanonicalModelAllowlist: ["doubao-seedance-2-0", "jimeng-video-ti2v-v30-pro"],
    });
    const model3dRows = listPublishedWorkspaceModel3dModels({
      publishedCanonicalModelAllowlist: ["doubao-seed3d-2-0", "tripo-p1"],
    });

    expect(videoRows.map((row) => row.registryId)).toEqual(["doubao-seedance-2-0", "jimeng-video-ti2v-v30-pro"]);
    expect(videoRows.find((row) => row.registryId === "doubao-seedance-2-0")?.gatewayReady).toBe(true);
    expect(videoRows.find((row) => row.registryId === "jimeng-video-ti2v-v30-pro")?.gatewayReady).toBe(true);
    expect(model3dRows.map((row) => row.registryId)).toEqual(["doubao-seed3d-2-0", "tripo-p1"]);
    expect(model3dRows.find((row) => row.registryId === "doubao-seed3d-2-0")?.gatewayReady).toBe(true);
    expect(model3dRows.find((row) => row.registryId === "tripo-p1")?.gatewayReady).toBe(true);
  });

  it("allows ops to publish smoke-tested Jimeng draft image models", () => {
    const imageRows = listPublishedWorkspaceImageModels({
      publishedCanonicalModelAllowlist: ["jimeng-image-t2i-v30", "jimeng-image-t2i-v31", "jimeng-image-t2i-v46"],
    });

    expect(imageRows.map((row) => row.registryId)).toEqual(["jimeng-image-t2i-v30", "jimeng-image-t2i-v31"]);
    expect(imageRows.every((row) => row.gatewayReady)).toBe(true);
  });
});
