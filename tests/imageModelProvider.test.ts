import { describe, expect, it, vi, afterEach } from "vitest";
import {
  hasGeminiImageProxyConfigured,
  imageModelRouteDisabledReason,
  isImageModelProviderRouteReady,
  isImageModelRegistryReady,
} from "../services/modelRegistry/imageModelProvider";
import * as settingsStore from "../services/settingsStore";

describe("imageModelProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("openai route requires enabled openai-official channel", () => {
    vi.spyOn(settingsStore, "getEnabledChannels").mockReturnValue(["openai-official"]);
    vi.spyOn(settingsStore, "getOpenaiApiKey").mockReturnValue(null);
    expect(isImageModelProviderRouteReady("openai")).toBe(false);
    expect(imageModelRouteDisabledReason("gpt-image-1.5")).toContain("OpenAI");
  });

  it("gemini route accepts gemini-aistudio key", () => {
    vi.spyOn(settingsStore, "getEnabledChannels").mockReturnValue(["gemini-aistudio"]);
    vi.spyOn(settingsStore, "getUserApiKey").mockReturnValue("gemini-key");
    expect(isImageModelProviderRouteReady("gemini")).toBe(true);
    expect(isImageModelRegistryReady("gemini-2.5-flash-image")).toBe(true);
    expect(imageModelRouteDisabledReason("gemini-2.5-flash-image")).toBeUndefined();
  });

  it("hasGeminiImageProxyConfigured reads bulk env", () => {
    const prev = import.meta.env.VITE_BULK_IMAGE_API;
    import.meta.env.VITE_BULK_IMAGE_API = "https://proxy.example";
    expect(hasGeminiImageProxyConfigured()).toBe(true);
    import.meta.env.VITE_BULK_IMAGE_API = prev;
  });
});
