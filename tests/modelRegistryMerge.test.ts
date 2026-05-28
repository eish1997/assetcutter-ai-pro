import { describe, expect, it, afterEach, vi } from "vitest";
import { buildEffectiveImageModelRows, pickCoercedImageModelId } from "../services/modelRegistry/merge";
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

  it("allowlist null keeps all models enabled when credentials exist", () => {
    vi.spyOn(settingsStore, "getEnabledChannels").mockReturnValue([
      "gemini-aistudio",
      "openai-official",
    ]);
    vi.spyOn(settingsStore, "isChannelReady").mockReturnValue(true);
    vi.spyOn(settingsStore, "getUserApiKey").mockReturnValue("gemini-key");
    vi.spyOn(settingsStore, "getOpenaiApiKey").mockReturnValue("openai-key");
    const rows = buildEffectiveImageModelRows({ ...DEFAULT_MODEL_OPS_CONFIG, imageRegistryAllowlist: null });
    expect(rows.every((r) => !r.disabled)).toBe(true);
    expect(rows).toHaveLength(5);
  });

  it("disables models when provider credentials missing", () => {
    vi.spyOn(settingsStore, "getEnabledChannels").mockReturnValue(["gemini-aistudio", "openai-official"]);
    vi.spyOn(settingsStore, "isChannelReady").mockImplementation(
      (ch) => ch === "gemini-aistudio"
    );
    vi.spyOn(settingsStore, "getUserApiKey").mockReturnValue("gemini-key");
    vi.spyOn(settingsStore, "getOpenaiApiKey").mockReturnValue(null);
    const rows = buildEffectiveImageModelRows({ ...DEFAULT_MODEL_OPS_CONFIG, imageRegistryAllowlist: null });
    expect(rows.find((x) => x.registryId === "gpt-image-1.5")?.disabled).toBe(true);
    expect(rows.find((x) => x.registryId === "gpt-image-1.5")?.disabledReason).toContain("OpenAI");
    expect(rows.find((x) => x.registryId === "gemini-2.5-flash-image")?.disabled).toBe(false);
  });

  it("allowlist restricts models", () => {
    const rows = buildEffectiveImageModelRows({
      version: 1,
      imageRegistryAllowlist: ["gemini-2.5-flash-image"],
      imageModelPreference: ["gemini-3.1-flash-image-preview", "gemini-2.5-flash-image"],
    });
    expect(rows.find((x) => x.registryId === "gemini-2.5-flash-image")?.disabled).toBe(false);
    expect(rows.find((x) => x.registryId === "gemini-3.1-flash-image-preview")?.disabled).toBe(true);
    expect(rows.find((x) => x.registryId === "gemini-3-pro-image-preview")?.disabled).toBe(true);
  });

  it("pickCoercedImageModelId falls back along preference", () => {
    const rows = buildEffectiveImageModelRows({
      version: 1,
      imageRegistryAllowlist: ["gemini-2.5-flash-image"],
      imageModelPreference: ["gemini-3.1-flash-image-preview", "gemini-2.5-flash-image"],
    });
    expect(
      pickCoercedImageModelId("gemini-3.1-flash-image-preview", rows, [
        "gemini-3.1-flash-image-preview",
        "gemini-2.5-flash-image",
      ])
    ).toBe("gemini-2.5-flash-image");
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
