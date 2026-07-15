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
    expect(rows).toHaveLength(7);
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

  it("migrates legacy gearPreference from remote ops JSON", () => {
    const rows = buildEffectiveImageModelRows({
      version: 1,
      imageRegistryAllowlist: null,
      imageModelPreference: ["gemini-2.5-flash-image"],
    });
    expect(pickCoercedImageModelId("fast", rows, ["fast"])).toBe("gemini-2.5-flash-image");
  });
});
