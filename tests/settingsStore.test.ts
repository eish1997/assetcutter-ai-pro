import { afterEach, describe, expect, it, vi } from "vitest";

describe("settingsStore channel readiness", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("can disable the Vertex site proxy while keeping the generic AI Worker Proxy configured", async () => {
    vi.stubEnv("VITE_AI_WORKER_PROXY_API", "same-origin");
    vi.stubEnv("VITE_AI_WORKER_PROXY_API_VERTEX", "same-origin");
    vi.stubEnv("VITE_DISABLE_VERTEX_SITE_PROXY", "true");
    vi.resetModules();

    const { isChannelReady, isVertexSiteProxyConfigured } = await import("../services/settingsStore");

    expect(isVertexSiteProxyConfigured()).toBe(false);
    expect(isChannelReady("vertex-proxy")).toBe(false);
    expect(isChannelReady("gemini-aistudio")).toBe(true);
  });
});
