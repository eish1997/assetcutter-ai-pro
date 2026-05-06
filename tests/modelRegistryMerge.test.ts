import { describe, expect, it, afterEach } from "vitest";
import { buildEffectiveImageGearRows, pickCoercedGearId } from "../services/modelRegistry/merge";
import {
  DEFAULT_MODEL_OPS_CONFIG,
  _resetModelOpsRemoteStateForTests,
  _setModelOpsConfigForTests,
} from "../services/modelRegistry/opsConfig";
import type { AiProvider } from "../services/settingsStore";

describe("modelRegistry merge", () => {
  const p = "gemini" as AiProvider;

  afterEach(() => {
    _resetModelOpsRemoteStateForTests();
    _setModelOpsConfigForTests({ ...DEFAULT_MODEL_OPS_CONFIG });
  });

  it("allowlist null keeps all gears enabled", () => {
    const rows = buildEffectiveImageGearRows(p, { ...DEFAULT_MODEL_OPS_CONFIG, imageRegistryAllowlist: null });
    expect(rows.every((r) => !r.disabled)).toBe(true);
    expect(rows).toHaveLength(3);
  });

  it("allowlist restricts gears", () => {
    const rows = buildEffectiveImageGearRows(p, {
      version: 1,
      imageRegistryAllowlist: ["gemini-2.5-flash-image"],
      gearPreference: ["fast", "standard"],
    });
    expect(rows.find((x) => x.id === "fast")?.disabled).toBe(false);
    expect(rows.find((x) => x.id === "standard")?.disabled).toBe(true);
    expect(rows.find((x) => x.id === "pro")?.disabled).toBe(true);
  });

  it("pickCoercedGearId falls back along preference", () => {
    const rows = buildEffectiveImageGearRows(p, {
      version: 1,
      imageRegistryAllowlist: ["gemini-2.5-flash-image"],
      gearPreference: ["standard", "fast"],
    });
    expect(pickCoercedGearId("standard", rows, ["standard", "fast"])).toBe("fast");
  });
});
