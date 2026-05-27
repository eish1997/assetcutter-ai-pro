import { describe, expect, it, vi, afterEach } from "vitest";
import { pickBinding, hasReadyBinding } from "../services/modelRegistry/pickBinding";
import {
  _resetModelOpsRemoteStateForTests,
  _setModelOpsConfigForTests,
  DEFAULT_MODEL_OPS_CONFIG,
} from "../services/modelRegistry/opsConfig";
import * as settingsStore from "../services/settingsStore";

describe("pickBinding", () => {
  afterEach(() => {
    _resetModelOpsRemoteStateForTests();
    _setModelOpsConfigForTests({ ...DEFAULT_MODEL_OPS_CONFIG });
    vi.restoreAllMocks();
  });

  it("picks vertex-proxy for gemini image when enabled and proxy configured", () => {
    vi.spyOn(settingsStore, "getEnabledChannels").mockReturnValue(["vertex-proxy"]);
    vi.spyOn(settingsStore, "isChannelReady").mockImplementation((ch) => ch === "vertex-proxy");
    const picked = pickBinding("gemini-3.1-flash-image-preview", "image");
    expect(picked?.channel).toBe("vertex-proxy");
    expect(picked?.upstreamModelId).toBe("gemini-3.1-flash-image-preview");
  });

  it("falls through to toapis-gemini when vertex not ready", () => {
    vi.spyOn(settingsStore, "getEnabledChannels").mockReturnValue(["vertex-proxy", "toapis-gemini"]);
    vi.spyOn(settingsStore, "isChannelReady").mockImplementation((ch) => ch === "toapis-gemini");
    const picked = pickBinding("gemini-3.1-flash-image-preview", "image");
    expect(picked?.channel).toBe("toapis-gemini");
  });

  it("picks openai-official for gpt-image when key ready", () => {
    vi.spyOn(settingsStore, "getEnabledChannels").mockReturnValue(["openai-official"]);
    vi.spyOn(settingsStore, "isChannelReady").mockReturnValue(true);
    const picked = pickBinding("gpt-image-1.5", "image");
    expect(picked?.channel).toBe("openai-official");
  });

  it("returns null when no enabled ready binding", () => {
    vi.spyOn(settingsStore, "getEnabledChannels").mockReturnValue(["vertex-proxy"]);
    vi.spyOn(settingsStore, "isChannelReady").mockReturnValue(false);
    expect(pickBinding("gemini-3.1-flash-image-preview", "image")).toBeNull();
    expect(hasReadyBinding("gemini-3.1-flash-image-preview", "image")).toBe(false);
  });

  it("respects ops bindingOverrides disable", () => {
    vi.spyOn(settingsStore, "getEnabledChannels").mockReturnValue(["vertex-proxy", "toapis-gemini"]);
    vi.spyOn(settingsStore, "isChannelReady").mockReturnValue(true);
    _setModelOpsConfigForTests({
      version: 1,
      imageRegistryAllowlist: null,
      bindingOverrides: [
        {
          bindingId: "gemini-3.1-flash-image-preview:vertex-proxy:image",
          enabled: false,
        },
      ],
    });
    const picked = pickBinding("gemini-3.1-flash-image-preview", "image");
    expect(picked?.channel).toBe("toapis-gemini");
  });
});
