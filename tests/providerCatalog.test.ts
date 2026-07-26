import { describe, expect, it } from "vitest";
import {
  getProviderCatalogEntry,
  listProviderModels,
  providerModelCount,
  providersForAdminConsole,
  providersForAdminKeyPool,
} from "../services/modelRegistry";

describe("provider catalog", () => {
  it("lists volcengine ark as a key-pool provider with direct links", () => {
    const providers = providersForAdminKeyPool();
    const ark = providers.find((provider) => provider.id === "volcengine-ark");

    expect(ark).toMatchObject({
      displayName: "火山方舟",
      keyPoolSupported: true,
      byokSupported: true,
      docsUrl: "https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1330310?lang=zh",
    });
    expect(ark?.supportedModalities).toEqual(expect.arrayContaining(["text", "image", "video", "model3d"]));
    expect(ark?.capabilityStatus).toMatchObject({
      catalogVisible: true,
      keyPoolSupported: true,
      backendAdapterReady: true,
      platformKeyReady: true,
      byokSupported: true,
      modelCatalogReady: true,
      smokeTestReady: true,
    });
  });

  it("shows site-proxy suppliers in the admin supplier center", () => {
    const adminProviders = providersForAdminConsole();
    const keyPoolProviders = providersForAdminKeyPool();

    expect(adminProviders.map((provider) => provider.id)).toContain("vertex-site");
    expect(keyPoolProviders.map((provider) => provider.id)).toContain("vertex-site");
    expect(getProviderCatalogEntry("vertex-site")?.displayName).toBe("Google Agent Platform");
    expect(getProviderCatalogEntry("vertex-site")?.shortName).toBe("Agent Platform");
    expect(getProviderCatalogEntry("vertex-site")?.authSchemes[0]?.label).toBe("Agent Platform API Key");
  });

  it("keeps provider identity separate from provider model rows", () => {
    const openai = getProviderCatalogEntry("openai-official");
    const tinySnow = getProviderCatalogEntry("tinysnow");
    const openaiModels = listProviderModels("openai-official");
    const tinySnowModels = listProviderModels("tinysnow");
    const arkModels = listProviderModels("volcengine-ark");

    expect(openai?.displayName).toBe("OpenAI");
    expect(tinySnow).toMatchObject({
      displayName: "TinySnow",
      keyPoolSupported: true,
      byokSupported: true,
      docsUrl: "https://www.yuque.com/tiny_snow/nrm7nk/rzpfzwmx9wtc64xg?singleDoc",
    });
    expect(openaiModels.map((model) => model.registryId)).toContain("gpt-image-2");
    expect(tinySnowModels.map((model) => model.registryId)).toContain("gpt-image-2");
    expect(arkModels.map((model) => model.registryId)).not.toContain("gpt-image-2");
    expect(arkModels.map((model) => model.providerModelId)).toEqual(
      expect.arrayContaining([
        "doubao-seed-2-0-pro-260215",
        "doubao-seedream-5-0-pro-260628",
        "doubao-seedance-2-0-260128",
        "doubao-seed3d-2-0-260328",
      ])
    );
    expect(arkModels.find((model) => model.registryId === "doubao-seed-2-0-pro")?.status).toBe("verified");
    expect(arkModels.find((model) => model.registryId === "doubao-seedream-5-0-pro")?.status).toBe("verified");
    expect(arkModels.find((model) => model.registryId === "doubao-seedance-2-0")?.status).toBe("testing");
  });

  it("advertises 302.AI multimodal gray candidates without marking them verified", () => {
    const provider = getProviderCatalogEntry("302ai");
    const models = listProviderModels("302ai");

    expect(provider?.supportedModalities).toEqual(expect.arrayContaining(["text", "image", "video", "model3d"]));
    expect(models.find((model) => model.registryId === "302ai-video-manual")).toMatchObject({
      providerId: "302ai",
      modality: "video",
      status: "requires_mapping",
      requiresEndpointMapping: true,
      endpointMapping: {
        required: ["requestPath", "pollPath", "statusPath", "artifactPath"],
      },
    });
    expect(models.find((model) => model.registryId === "302ai-model3d-manual")).toMatchObject({
      providerId: "302ai",
      modality: "model3d",
      status: "requires_mapping",
      requiresEndpointMapping: true,
      endpointMapping: {
        required: ["requestPath", "pollPath", "statusPath", "artifactPath"],
      },
    });
  });

  it("advertises Gemini text/image SKUs on 302.AI and AIHubMix aggregators", () => {
    const models302 = listProviderModels("302ai");
    const modelsMix = listProviderModels("aihubmix");

    expect(models302.some((model) => model.registryId?.startsWith("gemini-") && model.modality === "text")).toBe(
      true
    );
    expect(models302.some((model) => model.registryId?.startsWith("gemini-") && model.modality === "image")).toBe(
      true
    );
    expect(modelsMix.some((model) => model.registryId?.startsWith("gemini-") && model.modality === "text")).toBe(
      true
    );
    expect(modelsMix.some((model) => model.registryId?.startsWith("gemini-") && model.modality === "image")).toBe(
      true
    );
  });

  it("mirrors Jimeng static catalog into provider model catalog", () => {
    expect(providerModelCount("volcengine-jimeng")).toBeGreaterThan(5);
    expect(listProviderModels("volcengine-jimeng").some((model) => model.modality === "video")).toBe(true);
    expect(listProviderModels("volcengine-jimeng").some((model) => model.status === "testing")).toBe(true);
  });

  it("marks only currently wired platform-key suppliers as platform ready", () => {
    expect(getProviderCatalogEntry("tripo")?.capabilityStatus).toMatchObject({
      backendAdapterReady: true,
      platformKeyReady: true,
    });
    expect(getProviderCatalogEntry("volcengine-jimeng")?.capabilityStatus).toMatchObject({
      backendAdapterReady: true,
      platformKeyReady: true,
      smokeTestReady: true,
    });
    expect(getProviderCatalogEntry("openai-official")?.capabilityStatus).toMatchObject({
      backendAdapterReady: true,
      platformKeyReady: true,
      byokSupported: true,
    });
    expect(getProviderCatalogEntry("toapis")?.capabilityStatus).toMatchObject({
      backendAdapterReady: true,
      platformKeyReady: true,
      byokSupported: true,
    });
    expect(getProviderCatalogEntry("volcengine-ark")?.capabilityStatus).toMatchObject({
      backendAdapterReady: true,
      platformKeyReady: true,
    });
    expect(getProviderCatalogEntry("vertex-site")?.capabilityStatus).toMatchObject({
      backendAdapterReady: true,
      keyPoolSupported: true,
      platformKeyReady: true,
    });
  });
});
