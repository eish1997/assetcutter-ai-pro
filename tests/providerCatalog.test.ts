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
    expect(keyPoolProviders.map((provider) => provider.id)).not.toContain("vertex-site");
    expect(getProviderCatalogEntry("vertex-site")?.authSchemes[0]?.label).toBe("站点代理");
  });

  it("keeps provider identity separate from provider model rows", () => {
    const openai = getProviderCatalogEntry("openai-official");
    const openaiModels = listProviderModels("openai-official");
    const arkModels = listProviderModels("volcengine-ark");

    expect(openai?.displayName).toBe("OpenAI");
    expect(openaiModels.map((model) => model.registryId)).toContain("gpt-image-2");
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
  });
});
