import { describe, expect, it, vi, afterEach } from "vitest";
import { resolveTextModelIdFromContext } from "../services/capabilityExecutor";
import * as settingsStore from "../services/settingsStore";

describe("capabilityExecutor text resolve", () => {
  afterEach(() => {
    vi.restoreAllMocks();
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
