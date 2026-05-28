import { describe, expect, it, vi, afterEach } from "vitest";
import {
  resolveTextModelForPreset,
  resolveTextModelIdFromContext,
} from "../services/capabilityExecutor";
import * as settingsStore from "../services/settingsStore";
import type { CustomAppModule } from "../types";

describe("capabilityExecutor text resolve", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolveTextModelForPreset prefers preset binding over context default", () => {
    const preset = {
      id: "t1",
      label: "T",
      category: "text_to_text",
      instruction: "x",
      textModelRegistryId: "gpt-4o",
    } as CustomAppModule;
    expect(
      resolveTextModelForPreset(preset, { textModelRegistryId: "gemini-3-flash-preview" })
    ).toBe("gpt-4o");
  });

  it("resolveTextModelForPreset falls back to context when preset has no binding", () => {
    const preset = {
      id: "t2",
      label: "T",
      category: "text_to_text",
      instruction: "x",
    } as CustomAppModule;
    expect(resolveTextModelForPreset(preset, { textModelRegistryId: "gpt-4o-mini" })).toBe(
      "gpt-4o-mini"
    );
  });

  it("resolveTextModelIdFromContext uses pickBinding for openai-family text", () => {
    vi.spyOn(settingsStore, "getEnabledChannels").mockReturnValue(["openai-official"]);
    vi.spyOn(settingsStore, "isChannelReady").mockReturnValue(true);
    vi.spyOn(settingsStore, "getOpenaiApiKey").mockReturnValue("sk-test");
    expect(resolveTextModelIdFromContext({ textModelRegistryId: "gpt-4o-mini" })).toBe("gpt-4o-mini");
  });

  it("resolveTextModelIdFromContext falls back along family bindings for gemini text", () => {
    vi.spyOn(settingsStore, "getEnabledChannels").mockReturnValue(["toapis-gemini"]);
    vi.spyOn(settingsStore, "isChannelReady").mockImplementation((ch) => ch === "toapis-gemini");
    expect(resolveTextModelIdFromContext({})).toBe("gemini-3-flash-preview");
  });
});
