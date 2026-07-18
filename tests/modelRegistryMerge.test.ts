import { describe, expect, it, afterEach, vi } from "vitest";
import {
  buildEffectiveImageModelRows,
  buildEffectiveTextModelRows,
  pickCoercedImageModelId,
} from "../services/modelRegistry/merge";
import {
  DEFAULT_MODEL_OPS_CONFIG,
  _resetModelOpsRemoteStateForTests,
  _setModelOpsConfigForTests,
} from "../services/modelRegistry/opsConfig";
import * as settingsStore from "../services/settingsStore";

describe("modelRegistry merge", () => {
  afterEach(() => {
    _resetModelOpsRemoteStateForTests();
    _setModelOpsConfigForTests({ ...DEFAULT_MODEL_OPS_CONFIG });
    vi.restoreAllMocks();
  });

  it("allowlist null keeps gateway-ready image models enabled", () => {
    vi.spyOn(settingsStore, "getEnabledChannels").mockReturnValue([
      "gemini-aistudio",
      "openai-official",
    ]);
    vi.spyOn(settingsStore, "isChannelReady").mockReturnValue(true);
    vi.spyOn(settingsStore, "getUserApiKey").mockReturnValue("gemini-key");
    vi.spyOn(settingsStore, "getOpenaiApiKey").mockReturnValue("openai-key");
    const rows = buildEffectiveImageModelRows({ ...DEFAULT_MODEL_OPS_CONFIG, imageRegistryAllowlist: null });
    expect(rows.filter((r) => r.gatewayReady).every((r) => !r.disabled)).toBe(true);
    expect(rows.find((r) => r.registryId === "jimeng-image-t2i-v40")?.gatewayReady).toBe(true);
    expect(rows.find((r) => r.registryId === "jimeng-image-t2i-v40")?.disabled).toBe(false);
    expect(rows.length).toBeGreaterThanOrEqual(7);
  });

  it("does not let local BYOK credentials hide gateway-ready image models", () => {
    vi.spyOn(settingsStore, "getEnabledChannels").mockReturnValue(["gemini-aistudio", "openai-official"]);
    vi.spyOn(settingsStore, "isChannelReady").mockReturnValue(false);
    vi.spyOn(settingsStore, "getUserApiKey").mockReturnValue(null);
    vi.spyOn(settingsStore, "getOpenaiApiKey").mockReturnValue(null);
    const rows = buildEffectiveImageModelRows({ ...DEFAULT_MODEL_OPS_CONFIG, imageRegistryAllowlist: null });
    expect(rows.find((x) => x.registryId === "gpt-image-1.5")?.disabled).toBe(false);
    expect(rows.find((x) => x.registryId === "gemini-2.5-flash-image")?.disabled).toBe(false);
  });

  it("allowlist restricts models", () => {
    vi.spyOn(settingsStore, "getEnabledChannels").mockReturnValue([
      "gemini-aistudio",
      "openai-official",
    ]);
    vi.spyOn(settingsStore, "isChannelReady").mockReturnValue(true);
    vi.spyOn(settingsStore, "getUserApiKey").mockReturnValue("gemini-key");
    vi.spyOn(settingsStore, "getOpenaiApiKey").mockReturnValue("openai-key");
    const rows = buildEffectiveImageModelRows({
      version: 1,
      imageRegistryAllowlist: ["gemini-2.5-flash-image"],
      imageModelPreference: ["gemini-3.1-flash-image", "gemini-2.5-flash-image"],
    });
    expect(rows.find((x) => x.registryId === "gemini-2.5-flash-image")?.disabled).toBe(false);
    expect(rows.find((x) => x.registryId === "gemini-3.1-flash-image")?.disabled).toBe(true);
    expect(rows.find((x) => x.registryId === "gemini-3-pro-image")?.disabled).toBe(true);
  });

  it("published canonical allowlist restricts image rows before credential checks", () => {
    vi.spyOn(settingsStore, "getEnabledChannels").mockReturnValue([
      "gemini-aistudio",
      "openai-official",
    ]);
    vi.spyOn(settingsStore, "isChannelReady").mockReturnValue(true);
    vi.spyOn(settingsStore, "getUserApiKey").mockReturnValue("gemini-key");
    vi.spyOn(settingsStore, "getOpenaiApiKey").mockReturnValue("openai-key");

    const rows = buildEffectiveImageModelRows({
      ...DEFAULT_MODEL_OPS_CONFIG,
      publishedCanonicalModelAllowlist: ["gemini-2.5-flash-image"],
    });

    expect(rows.map((row) => row.registryId)).toEqual(["gemini-2.5-flash-image"]);
    expect(rows[0]?.disabled).toBe(false);
  });

  it("published canonical allowlist restricts text rows", () => {
    vi.spyOn(settingsStore, "getEnabledChannels").mockReturnValue(["openai-official"]);
    vi.spyOn(settingsStore, "isChannelReady").mockReturnValue(true);
    vi.spyOn(settingsStore, "getOpenaiApiKey").mockReturnValue("openai-key");

    const rows = buildEffectiveTextModelRows({
      publishedCanonicalModelAllowlist: ["gpt-4o-mini"],
    });

    expect(rows.map((row) => row.registryId)).toEqual(["gpt-4o-mini"]);
    expect(rows[0]?.disabled).toBe(false);
  });

  it("pickCoercedImageModelId falls back along preference", () => {
    vi.spyOn(settingsStore, "getEnabledChannels").mockReturnValue([
      "gemini-aistudio",
      "openai-official",
    ]);
    vi.spyOn(settingsStore, "isChannelReady").mockReturnValue(true);
    vi.spyOn(settingsStore, "getUserApiKey").mockReturnValue("gemini-key");
    vi.spyOn(settingsStore, "getOpenaiApiKey").mockReturnValue("openai-key");
    const rows = buildEffectiveImageModelRows({
      version: 1,
      imageRegistryAllowlist: ["gemini-2.5-flash-image"],
      imageModelPreference: ["gemini-3.1-flash-image", "gemini-2.5-flash-image"],
    });
    expect(
      pickCoercedImageModelId("gemini-3.1-flash-image", rows, [
        "gemini-3.1-flash-image",
        "gemini-2.5-flash-image",
      ])
    ).toBe("gemini-2.5-flash-image");
  });

  it("default image fallback prefers the verified Pro image model over unavailable Gemini 3.1 Flash Image", () => {
    vi.spyOn(settingsStore, "getEnabledChannels").mockReturnValue([
      "vertex-proxy",
      "gemini-aistudio",
      "openai-official",
    ]);
    vi.spyOn(settingsStore, "isChannelReady").mockReturnValue(true);
    vi.spyOn(settingsStore, "getUserApiKey").mockReturnValue("gemini-key");
    vi.spyOn(settingsStore, "getOpenaiApiKey").mockReturnValue("openai-key");

    const rows = buildEffectiveImageModelRows({ ...DEFAULT_MODEL_OPS_CONFIG, imageRegistryAllowlist: null });

    expect(rows.find((x) => x.registryId === "gemini-3.1-flash-image")?.disabled).toBe(true);
    expect(pickCoercedImageModelId("gemini-3.1-flash-image", rows, undefined)).toBe("gemini-3-pro-image");
  });

  it("migrates legacy gearPreference from remote ops JSON", () => {
    const rows = buildEffectiveImageModelRows({
      version: 1,
      imageRegistryAllowlist: null,
      imageModelPreference: ["gemini-2.5-flash-image"],
    });
    expect(pickCoercedImageModelId("fast", rows, ["fast"])).toBe("gemini-2.5-flash-image");
  });
});
