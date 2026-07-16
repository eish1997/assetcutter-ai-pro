import { describe, expect, it } from "vitest";
import { modelSupportsParameter, resolveModelParameterCapabilities } from "../services/modelRegistry";

describe("model parameter capabilities", () => {
  it("declares Ark Seedance video parameters without 3D-only controls", () => {
    const caps = resolveModelParameterCapabilities({ registryId: "doubao-seedance-2-0", modality: "video" });

    expect(caps.providerId).toBe("volcengine-ark");
    expect(caps.supported.map((cap) => cap.key)).toEqual(
      expect.arrayContaining(["prompt", "referenceImages", "durationSeconds", "aspectRatio", "resolution", "motionStrength"])
    );
    expect(modelSupportsParameter("doubao-seedance-2-0", "video", "texture")).toBe(false);
  });

  it("keeps Ark Seed3D separate from Tripo-specific parameters", () => {
    const caps = resolveModelParameterCapabilities({ registryId: "doubao-seed3d-2-0", modality: "model3d" });

    expect(caps.providerId).toBe("volcengine-ark");
    expect(caps.supported.map((cap) => cap.key)).toEqual(
      expect.arrayContaining(["prompt", "referenceImages", "quality", "format", "texture"])
    );
    expect(modelSupportsParameter("doubao-seed3d-2-0", "model3d", "taskType")).toBe(false);
    expect(modelSupportsParameter("doubao-seed3d-2-0", "model3d", "modelVersion")).toBe(false);
    expect(modelSupportsParameter("doubao-seed3d-2-0", "model3d", "negativePrompt")).toBe(false);
  });

  it("declares Tripo and Tencent 3D controls independently", () => {
    expect(modelSupportsParameter("tripo-p1", "model3d", "taskType")).toBe(true);
    expect(modelSupportsParameter("tripo-p1", "model3d", "negativePrompt")).toBe(true);
    expect(modelSupportsParameter("tencent-hunyuan-3d-pro", "model3d", "taskType")).toBe(false);
    expect(modelSupportsParameter("tencent-hunyuan-3d-pro", "model3d", "pbr")).toBe(true);
  });
});
