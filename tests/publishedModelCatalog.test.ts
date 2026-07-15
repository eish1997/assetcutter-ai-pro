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

  it("keeps warehouse-only Jimeng image models out of the generic dialog image picker", () => {
    const rows = listPublishedWorkspaceImageModels();

    expect(rows.map((row) => row.registryId)).toContain("gpt-image-2");
    expect(rows.some((row) => row.registryId.startsWith("jimeng-"))).toBe(false);
    expect(rows.every((row) => row.modality === "image")).toBe(true);
  });

  it("filters published image models by canonical allowlist", () => {
    const rows = listPublishedWorkspaceImageModels({
      publishedCanonicalModelAllowlist: ["gemini-2.5-flash-image", "gpt-4o-mini"],
    });

    expect(rows.map((row) => row.registryId)).toEqual(["gemini-2.5-flash-image"]);
  });

  it("uses the admin allowlist as publication source for draft video and 3D models", () => {
    const videoRows = listPublishedWorkspaceVideoModels({
      publishedCanonicalModelAllowlist: ["doubao-seedance-2-0", "jimeng-video-ti2v-v30-pro"],
    });
    const model3dRows = listPublishedWorkspaceModel3dModels({
      publishedCanonicalModelAllowlist: ["doubao-seed3d-2-0", "tripo-p1"],
    });

    expect(videoRows.map((row) => row.registryId)).toEqual(["doubao-seedance-2-0", "jimeng-video-ti2v-v30-pro"]);
    expect(videoRows.find((row) => row.registryId === "doubao-seedance-2-0")?.gatewayReady).toBe(false);
    expect(videoRows.find((row) => row.registryId === "jimeng-video-ti2v-v30-pro")?.gatewayReady).toBe(true);
    expect(model3dRows.map((row) => row.registryId)).toEqual(["doubao-seed3d-2-0", "tripo-p1"]);
    expect(model3dRows.find((row) => row.registryId === "doubao-seed3d-2-0")?.gatewayReady).toBe(false);
    expect(model3dRows.find((row) => row.registryId === "tripo-p1")?.gatewayReady).toBe(true);
  });
});
