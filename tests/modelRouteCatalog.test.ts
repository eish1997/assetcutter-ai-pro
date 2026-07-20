import { describe, expect, it } from "vitest";
import { normalizeAiGatewayProviderId } from "../shared/aiGatewayModelRoutes.js";
import {
  getCanonicalModel,
  listModelRoutes,
  listPublishedCanonicalModels,
  listProviderRoutes,
  routeProvidersForCanonicalModel,
} from "../services/modelRegistry";

describe("model route catalog", () => {
  it("normalizes Google Agent Platform aliases to the legacy site route id", () => {
    expect(normalizeAiGatewayProviderId("google-agent-platform")).toBe("vertex-site");
    expect(normalizeAiGatewayProviderId("agent-platform")).toBe("vertex-site");
    expect(normalizeAiGatewayProviderId("vertex-proxy")).toBe("vertex-site");
  });

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

    expect(providers).toEqual(expect.arrayContaining(["openai-official", "tinysnow", "toapis"]));
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
    expect(routes.find((route) => route.providerId === "tinysnow")).toMatchObject({
      channel: "tinysnow-openai",
      executionStatus: "disabled",
      gatewayExecutionStatus: "gateway_ready",
    });
  });

  it("marks stable Vertex Gemini routes as platform ready site-proxy routes", () => {
    const textRoute = listModelRoutes("gemini-3-flash-preview").find((route) => route.providerId === "vertex-site");
    const imageRoute = listModelRoutes("gemini-3-pro-image").find((route) => route.providerId === "vertex-site");

    expect(textRoute).toMatchObject({
      executionStatus: "platform_ready",
      gatewayExecutionStatus: "gateway_ready",
    });
    expect(imageRoute).toMatchObject({
      executionStatus: "platform_ready",
      gatewayExecutionStatus: "gateway_ready",
    });
  });

  it("advertises Gemini 3.1 image family as Gateway executable", () => {
    const route = listModelRoutes("gemini-3.1-flash-image").find((row) => row.providerId === "vertex-site");
    expect(route).toMatchObject({
      executionStatus: "platform_ready",
      gatewayExecutionStatus: "gateway_ready",
    });
    expect(listModelRoutes("gemini-3.1-flash-lite-image").find((row) => row.providerId === "vertex-site")).toMatchObject({
      executionStatus: "platform_ready",
      gatewayExecutionStatus: "gateway_ready",
    });
  });

  it("does not advertise unavailable Gemini 3 Pro Preview as Gateway executable", () => {
    const route = listModelRoutes("gemini-3-pro-preview").find((row) => row.providerId === "vertex-site");
    expect(route).toMatchObject({
      executionStatus: "platform_ready",
      gatewayExecutionStatus: "adapter_pending",
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
      executionStatus: "platform_ready",
      gatewayExecutionStatus: "gateway_ready",
    });
    expect(arkRoutes.find((route) => route.canonicalModelId === "doubao-seed3d-2-0")).toMatchObject({
      executionStatus: "platform_ready",
      gatewayExecutionStatus: "gateway_ready",
    });
  });

  it("keeps provider route inventory queryable from supplier center", () => {
    const arkRoutes = listProviderRoutes("volcengine-ark");
    const jimengRoutes = listProviderRoutes("volcengine-jimeng");
    const tripoRoutes = listProviderRoutes("tripo");
    const hunyuanRoutes = listProviderRoutes("tencent-hunyuan");

    expect(arkRoutes.some((route) => route.canonicalModelId === "doubao-seed-2-0-pro")).toBe(true);
    expect(jimengRoutes.some((route) => route.modality === "video")).toBe(true);
    expect(jimengRoutes.some((route) => route.executionStatus === "platform_ready")).toBe(true);
    expect(jimengRoutes.some((route) => route.gatewayExecutionStatus === "gateway_ready")).toBe(true);
    expect(tripoRoutes.find((route) => route.canonicalModelId === "tripo-v3.0")).toMatchObject({
      executionStatus: "platform_ready",
      gatewayExecutionStatus: "gateway_ready",
    });
    expect(tripoRoutes.find((route) => route.canonicalModelId === "tripo-v2.0")).toMatchObject({
      executionStatus: "platform_ready",
      gatewayExecutionStatus: "gateway_ready",
    });
    expect(hunyuanRoutes.find((route) => route.canonicalModelId === "tencent-hunyuan-3d-rapid")).toMatchObject({
      executionStatus: "platform_ready",
      gatewayExecutionStatus: "gateway_ready",
    });
    expect(tripoRoutes.map((route) => route.canonicalModelId)).toEqual(
      expect.arrayContaining(["tripo-p1", "tripo-v3.1", "tripo-v3.0", "tripo-v2.5", "tripo-v2.0"])
    );
    expect(tripoRoutes.every((route) => route.gatewayExecutionStatus === "gateway_ready")).toBe(true);
  });

  it("marks backend Gateway executable routes separately from supplier capability", () => {
    expect(listModelRoutes("gemini-3-pro-image-preview").some((route) => route.gatewayExecutionStatus === "gateway_ready")).toBe(true);
    expect(listModelRoutes("tripo-p1").some((route) => route.gatewayExecutionStatus === "gateway_ready")).toBe(true);
    expect(listModelRoutes("tencent-hunyuan-3d-pro").some((route) => route.gatewayExecutionStatus === "gateway_ready")).toBe(true);
  });
});
