import { describe, expect, it } from "vitest";
import { createAiGatewayJobPlan } from "../server/ai-gateway/index.js";
import { resolveExecutableAiGatewayModelRoute } from "../shared/aiGatewayModelRoutes.js";
import {
  listPublishedWorkspaceImageModels,
  listPublishedWorkspaceModel3dModels,
  listPublishedWorkspaceTextModels,
  listPublishedWorkspaceVideoModels,
  type PublishedWorkspaceModelRow,
} from "../services/modelRegistry";

function promptFor(row: PublishedWorkspaceModelRow): Record<string, unknown> {
  const text =
    row.modality === "text"
      ? "hello"
      : row.modality === "image"
        ? "a clean product photo"
        : row.modality === "video"
          ? "a clean product video"
          : "a low poly product model";
  return {
    prompt: text,
    contents: [{ role: "user", parts: [{ text }] }],
    ...(row.modality === "video" ? { durationSeconds: 1 } : {}),
  };
}

function readyRows(): PublishedWorkspaceModelRow[] {
  const ops = {
    publishedCanonicalModelAllowlist: [
      "gemini-3-flash-preview",
      "gpt-4o-mini",
      "gpt-image-2",
      "gemini-2.5-flash-image",
      "doubao-seed-2-0-pro",
      "doubao-seedream-5-0",
      "doubao-seedance-2-0",
      "doubao-seed3d-2-0",
      "jimeng-video-ti2v-v30-pro",
      "tripo-p1",
      "tripo-v3.1",
      "tencent-hunyuan-3d-pro",
    ],
  };
  return [
    ...listPublishedWorkspaceTextModels(ops),
    ...listPublishedWorkspaceImageModels(ops),
    ...listPublishedWorkspaceVideoModels(ops),
    ...listPublishedWorkspaceModel3dModels(ops),
  ].filter((row) => row.gatewayReady);
}

describe("published model route consistency", () => {
  it("creates backend plans for every published gateway-ready workspace model", () => {
    const rows = readyRows();
    expect(rows.map((row) => row.registryId)).toEqual(
      expect.arrayContaining([
        "doubao-seed-2-0-pro",
        "doubao-seedream-5-0",
        "doubao-seedance-2-0",
        "doubao-seed3d-2-0",
        "jimeng-video-ti2v-v30-pro",
        "tripo-p1",
        "tripo-v3.1",
      ])
    );

    for (const row of rows) {
      const executable = resolveExecutableAiGatewayModelRoute({
        canonicalModelId: row.canonicalModelId,
        modality: row.modality,
      });
      expect(executable, row.registryId).toBeTruthy();

      const plan = createAiGatewayJobPlan({
        modality: row.modality,
        model: row.registryId,
        provider: executable?.providerId,
        input: promptFor(row),
      });

      expect(plan.job.provider, row.registryId).toBe(executable?.providerId);
      expect(plan.route.providerId, row.registryId).toBe(executable?.providerId);
      expect(plan.route.adapterId, row.registryId).toBeTruthy();
      expect(plan.workerRequest, row.registryId).toBeTruthy();
    }
  });
});
