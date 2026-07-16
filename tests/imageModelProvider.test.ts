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
    vi.unstubAllEnvs();
  });

  it("openai route requires enabled openai-official channel", () => {
    vi.spyOn(settingsStore, "getEnabledChannels").mockReturnValue(["openai-official"]);
    vi.spyOn(settingsStore, "getOpenaiApiKey").mockReturnValue(null);
    expect(isImageModelProviderRouteReady("openai")).toBe(false);
    expect(imageModelRouteDisabledReason("gpt-image-1.5")).toContain("OpenAI");
  });

  it("gemini route accepts gemini-aistudio key", () => {
    vi.spyOn(settingsStore, "getEnabledChannels").mockReturnValue(["gemini-aistudio"]);
    vi.spyOn(settingsStore, "isChannelReady").mockImplementation((channel) => channel === "gemini-aistudio");
    expect(isImageModelProviderRouteReady("gemini")).toBe(true);
    expect(isImageModelRegistryReady("gemini-2.5-flash-image")).toBe(true);
    expect(imageModelRouteDisabledReason("gemini-2.5-flash-image")).toBeUndefined();
  });

  it("hasGeminiImageProxyConfigured reads AI Worker Proxy base env", () => {
    vi.stubEnv("VITE_AI_WORKER_PROXY_API", "https://proxy.example");
    expect(hasGeminiImageProxyConfigured()).toBe(true);
  });

  it("hasGeminiImageProxyConfigured reads AI Worker Proxy Vertex env", () => {
    vi.stubEnv("VITE_AI_WORKER_PROXY_API", "");
    vi.stubEnv("VITE_AI_WORKER_PROXY_API_VERTEX", "https://vertex-proxy.example");
    expect(hasGeminiImageProxyConfigured()).toBe(true);
  });
});
