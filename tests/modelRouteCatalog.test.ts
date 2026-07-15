import { describe, expect, it } from "vitest";
import {
  getCanonicalModel,
  listModelRoutes,
  listPublishedCanonicalModels,
  listProviderRoutes,
  routeProvidersForCanonicalModel,
} from "../services/modelRegistry";

describe("model route catalog", () => {
  it("publishes canonical text and image models separately from provider routes", () => {
    const imageModels = listPublishedCanonicalModels("image");
    const gptImage = getCanonicalModel("gpt-image-2");

    expect(imageModels.map((model) => model.canonicalModelId)).toContain("gpt-image-2");
    expect(gptImage).toMatchObject({
      canonicalModelId: "gpt-image-2",
      modality: "image",
      status: "published",
      visibleInWorkspace: true,
    });
  });

  it("maps one canonical OpenAI image model to OpenAI-compatible supplier routes", () => {
    const providers = routeProvidersForCanonicalModel("gpt-image-2");
    const routes = listModelRoutes("gpt-image-2");

    expect(providers).toEqual(expect.arrayContaining(["openai-official", "toapis"]));
    expect(providers).not.toContain("volcengine-ark");
    expect(routes.find((route) => route.providerId === "openai-official")).toMatchObject({
      enabled: true,
      priority: 10,
      channel: "openai-official",
      executionStatus: "platform_ready",
      gatewayExecutionStatus: "gateway_ready",
    });
    expect(routes.find((route) => route.providerId === "toapis")).toMatchObject({
      executionStatus: "platform_ready",
      gatewayExecutionStatus: "gateway_ready",
    });
  });

  it("maps Volcengine Ark to Doubao and Seed provider models", () => {
    const arkRoutes = listProviderRoutes("volcengine-ark");

    expect(arkRoutes.map((route) => route.providerModelId)).toEqual(
      expect.arrayContaining([
        "doubao-seed-2-0-pro-260215",
        "doubao-seedream-5-0-pro-260628",
        "doubao-seedance-2-0-260128",
        "doubao-seed3d-2-0-260328",
      ])
    );
    expect(arkRoutes.find((route) => route.canonicalModelId === "doubao-seed-2-0-pro")).toMatchObject({
      executionStatus: "platform_ready",
      gatewayExecutionStatus: "gateway_ready",
    });
    expect(arkRoutes.find((route) => route.canonicalModelId === "doubao-seedream-5-0-pro")).toMatchObject({
      executionStatus: "platform_ready",
      gatewayExecutionStatus: "gateway_ready",
    });
    expect(arkRoutes.find((route) => route.canonicalModelId === "doubao-seedance-2-0")).toMatchObject({
      executionStatus: "adapter_pending",
      gatewayExecutionStatus: "adapter_pending",
    });
  });

  it("keeps provider route inventory queryable from supplier center", () => {
    const arkRoutes = listProviderRoutes("volcengine-ark");
    const jimengRoutes = listProviderRoutes("volcengine-jimeng");

    expect(arkRoutes.some((route) => route.canonicalModelId === "doubao-seed-2-0-pro")).toBe(true);
    expect(jimengRoutes.some((route) => route.modality === "video")).toBe(true);
    expect(jimengRoutes.some((route) => route.executionStatus === "platform_ready")).toBe(true);
    expect(jimengRoutes.some((route) => route.gatewayExecutionStatus === "gateway_ready")).toBe(true);
  });

  it("marks backend Gateway executable routes separately from supplier capability", () => {
    expect(listModelRoutes("gemini-3-pro-image-preview").some((route) => route.gatewayExecutionStatus === "gateway_ready")).toBe(true);
    expect(listModelRoutes("tripo-p1").some((route) => route.gatewayExecutionStatus === "gateway_ready")).toBe(true);
    expect(listModelRoutes("tencent-hunyuan-3d-pro").some((route) => route.gatewayExecutionStatus === "adapter_pending")).toBe(true);
  });
});
